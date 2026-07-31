import {
  contextualHabitRuleMap,
  contextualPronouns,
  habitRuleMap,
  phraseHabitRules,
  type HabitRule,
} from "@/data/habit-rules";
import { isUnknownWord } from "@/lib/spellcheck";
import { isSafePhraseScope } from "@/lib/phrase-scope";

export type AiTypoInfo = {
  /** 置換対象の原文の範囲。単語1語のことも "am believing" のような句のこともある。 */
  phrase: string;
  /** phrase を置き換える正しい表現。 */
  correction: string;
  explanation: string;
};

export type Token =
  | {
      type: "text";
      key: string;
      text: string;
      // 直前の word トークンにくっついたまま改行させたくない句読点
      // （例: "think" の直後の "."）であることを示すフラグ。
      attachedToPrevious?: boolean;
    }
  | {
      type: "word";
      key: string;
      text: string;
      start: number;
      end: number;
      rule?: HabitRule;
      // rule が「同語の重複使用」判定によって付与された場合の、文章内での出現回数。
      occurrenceCount?: number;
      isUnknownWord?: boolean;
      isAiTypo?: boolean;
      aiCorrection?: string;
      aiExplanation?: string;
      // 置換範囲。句レベルの修正（例: "am believing" → "believe"）では
      // 単語1語ではなく句全体を差し替えるため、単語トークンとは別に保持する。
      aiReplaceStart?: number;
      aiReplaceEnd?: number;
    };

const SENTENCE_END_PATTERN = /[.!?]/;
const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
const ATTACHED_PUNCTUATION_PATTERN = /^[.,!?;:]+/;

// think/bad のような基本語は、文章内で2回以上使われて初めて
// 「重複・多用」とみなしてハイライトする（1回だけの自然な使用はスルーする）。
const MIN_OCCURRENCES_FOR_HIGHLIGHT = 2;

type Span = { start: number; end: number; text: string; rule?: HabitRule };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 各フレーズルールについて、単語間の空白量に多少の揺れがあっても
// マッチできるよう `\s+` で区切った上で単語境界付きの正規表現を作る。
const phrasePatterns = phraseHabitRules.map((rule) => ({
  rule,
  pattern: new RegExp(`\\b${rule.word.split(/\s+/).map(escapeRegExp).join("\\s+")}\\b`, "gi"),
}));

/**
 * 定型フレーズ（"in my opinion" 等）の出現箇所を文章全体から検出する。
 * フレーズ同士が重なる場合は、開始位置が早く・長い方を優先して残す。
 */
function findPhraseSpans(text: string): Span[] {
  if (phrasePatterns.length === 0) return [];

  const rawMatches: Span[] = [];
  for (const { rule, pattern } of phrasePatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      rawMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        rule,
      });
    }
  }

  rawMatches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const accepted: Span[] = [];
  let lastEnd = -1;
  for (const span of rawMatches) {
    if (span.start >= lastEnd) {
      accepted.push(span);
      lastEnd = span.end;
    }
  }
  return accepted;
}

/**
 * コーパスルールに登録された単語（単語1語のもの）が文章内で
 * それぞれ何回出現しているかを数える（大文字小文字は区別しない）。
 */
function countHabitWordOccurrences(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const lower = match[0].toLowerCase();
    if (habitRuleMap.has(lower)) {
      counts.set(lower, (counts.get(lower) ?? 0) + 1);
    }
  }
  return counts;
}

export function tokenize(text: string, dictionary?: Set<string> | null): Token[] {
  const tokens: Token[] = [];
  const phraseSpans = findPhraseSpans(text);
  const wordCounts = countHabitWordOccurrences(text);
  let phraseIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let atSentenceStart = true;
  WORD_PATTERN.lastIndex = 0;

  // 直前の word トークンの直後に空白なしで続く句読点（. , ! ? ; :）は、
  // 折り返し時にその句読点だけが孤立して次行に落ちないよう、別トークンに
  // 分けつつ `attachedToPrevious` を立てて描画側で単語とまとめさせる。
  function flushGap(upTo: number) {
    if (upTo <= lastIndex) return;
    const gap = text.slice(lastIndex, upTo);
    const previousIsWord = tokens.length > 0 && tokens[tokens.length - 1].type === "word";

    if (previousIsWord) {
      const attachedMatch = gap.match(ATTACHED_PUNCTUATION_PATTERN);
      if (attachedMatch) {
        const attached = attachedMatch[0];
        const rest = gap.slice(attached.length);
        tokens.push({
          type: "text",
          key: `t-${lastIndex}`,
          text: attached,
          attachedToPrevious: true,
        });
        if (rest) {
          tokens.push({ type: "text", key: `t-${lastIndex + attached.length}`, text: rest });
        }
        if (SENTENCE_END_PATTERN.test(gap)) atSentenceStart = true;
        return;
      }
    }

    tokens.push({ type: "text", key: `t-${lastIndex}`, text: gap });
    if (SENTENCE_END_PATTERN.test(gap)) atSentenceStart = true;
  }

  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;

    // 直前に出力したフレーズトークンの内側にある単語（2語目以降）は、
    // 既に1つのトークンとして出力済みなので個別には処理しない。
    if (start < lastIndex) continue;

    // 現在位置より前で終わっているフレーズ候補は読み飛ばす。
    while (phraseIndex < phraseSpans.length && phraseSpans[phraseIndex].end <= start) {
      phraseIndex++;
    }

    const phrase = phraseSpans[phraseIndex];
    if (phrase && start === phrase.start) {
      // フレーズの先頭単語に到達したので、フレーズ全体を1トークンとして出力する。
      flushGap(phrase.start);
      tokens.push({
        type: "word",
        key: `p-${phrase.start}`,
        text: phrase.text,
        start: phrase.start,
        end: phrase.end,
        rule: phrase.rule,
        isUnknownWord: false,
      });
      lastIndex = phrase.end;
      atSentenceStart = false;
      continue;
    }

    flushGap(start);

    const lower = word.toLowerCase();
    const candidateRule = habitRuleMap.get(lower);
    const occurrenceCount = candidateRule ? wordCounts.get(lower) : undefined;
    const rule =
      candidateRule && (occurrenceCount ?? 0) >= MIN_OCCURRENCES_FOR_HIGHLIGHT
        ? candidateRule
        : undefined;

    tokens.push({
      type: "word",
      key: `w-${start}`,
      text: word,
      start,
      end,
      rule,
      occurrenceCount: rule ? occurrenceCount : undefined,
      isUnknownWord:
        !rule && dictionary ? isUnknownWord(word, atSentenceStart, dictionary) : false,
    });

    atSentenceStart = false;
    lastIndex = end;
  }

  flushGap(text.length);

  return tokens;
}

/**
 * AI（文脈チェック）が「実在するが文脈上誤り」と確認済みの単語（小文字化
 * した単語文字列がキー）を、対応する word トークンに反映する。
 * コーパスルール単語（rule 付き）は対象外とする。
 */
export function applyAiTypoFlags(
  tokens: Token[],
  aiTypos: Map<string, AiTypoInfo>,
  text: string,
): Token[] {
  if (aiTypos.size === 0) return tokens;

  return tokens.map((token) => {
    if (token.type !== "word" || token.rule) return token;

    const match = aiTypos.get(token.text.toLowerCase());
    if (!match) return token;

    // 句レベルの修正では、その単語を含む句の範囲を原文から探して置換範囲にする。
    // 見つからない場合（本文が編集された等）は単語1語の範囲にフォールバックする。
    //
    // 置換範囲が広すぎる句（対象語と無関係な動詞・目的語を含むもの）は、
    // 適用時にそれらを巻き込んで削除してしまうため、サーバー側で弾いている。
    // ここでも同じ判定を行い、万一届いた場合でも単語1語の範囲に留める。
    const range = isSafePhraseScope(token.text, match.phrase)
      ? findPhraseRange(text, match.phrase, token.start, token.end)
      : null;

    return {
      ...token,
      isAiTypo: true,
      aiCorrection: match.correction,
      aiExplanation: match.explanation,
      aiReplaceStart: range?.start ?? token.start,
      aiReplaceEnd: range?.end ?? token.end,
    };
  });
}

/**
 * `phrase` の出現箇所のうち、[wordStart, wordEnd] を含むものを探す。
 * 例: "I am believing that..." の "believing" に対して phrase="am believing" を
 * 渡すと、"am believing" の範囲を返す。
 */
function findPhraseRange(
  text: string,
  phrase: string,
  wordStart: number,
  wordEnd: number,
): { start: number; end: number } | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;

  // 単語1語の修正なら、そのトークンの範囲をそのまま使う。
  if (trimmed.toLowerCase() === text.slice(wordStart, wordEnd).toLowerCase()) {
    return { start: wordStart, end: wordEnd };
  }

  let index = text.indexOf(trimmed);
  while (index !== -1) {
    const end = index + trimmed.length;
    if (index <= wordStart && wordEnd <= end) return { start: index, end };
    index = text.indexOf(trimmed, index + 1);
  }
  return null;
}

/**
 * AIが「人々全般を指す曖昧な用法」と確認済みの we/us/our の出現箇所
 * （トークンの start 位置の集合）を、対応する word トークンに反映する。
 * 具体的な人物を指すと判断された we/us/our にはハイライトを付けない。
 */
export function applyPronounContextFlags(
  tokens: Token[],
  vagueStarts: ReadonlySet<number>,
): Token[] {
  if (vagueStarts.size === 0) return tokens;

  return tokens.map((token) => {
    if (token.type !== "word" || token.rule) return token;
    if (!contextualPronouns.has(token.text.toLowerCase())) return token;
    if (!vagueStarts.has(token.start)) return token;

    const rule = contextualHabitRuleMap.get(token.text.toLowerCase());
    if (!rule) return token;

    return { ...token, rule };
  });
}

const MAX_CONTEXT_LENGTH = 500;

/**
 * `position` を含む一文を、文末記号（. ! ?）を区切りとして抽出する。
 * 文境界が見つからない場合はテキスト全体（上限あり）を返す。
 */
export function getContextSentence(text: string, position: number): string {
  const trimmedFull = text.trim();
  if (!trimmedFull) return "";

  const boundaryPattern = /[.!?](?:\s+|$)/g;
  let sentenceStart = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryPattern.exec(text)) !== null) {
    const sentenceEnd = match.index + match[0].length;
    if (position < sentenceEnd) {
      const sentence = text.slice(sentenceStart, sentenceEnd).trim();
      return (sentence || trimmedFull).slice(0, MAX_CONTEXT_LENGTH);
    }
    sentenceStart = sentenceEnd;
  }

  const remainder = text.slice(sentenceStart).trim();
  return (remainder || trimmedFull).slice(0, MAX_CONTEXT_LENGTH);
}

function getSentenceRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const boundaryPattern = /[.!?](?:\s+|$)/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryPattern.exec(text)) !== null) {
    const end = match.index + match[0].length;
    ranges.push({ start, end });
    start = end;
  }
  if (start < text.length) {
    ranges.push({ start, end: text.length });
  }
  return ranges;
}

/**
 * `position` を含む文に加えて、直前の `lookback` 文分の文脈も連結して返す。
 * 代名詞（we/us/our 等）の先行詞が前の文で紹介されている場合
 * （例: "...my friend Lehi. As we conversed..."）でも判定できるようにするため。
 */
export function getExtendedContext(text: string, position: number, lookback = 1): string {
  const trimmedFull = text.trim();
  if (!trimmedFull) return "";

  const ranges = getSentenceRanges(text);
  if (ranges.length === 0) return trimmedFull.slice(0, MAX_CONTEXT_LENGTH);

  const targetIndex = ranges.findIndex((range) => position < range.end);
  const effectiveIndex = targetIndex === -1 ? ranges.length - 1 : targetIndex;
  const startIndex = Math.max(0, effectiveIndex - lookback);

  const rangeStart = ranges[startIndex].start;
  const rangeEnd = ranges[effectiveIndex].end;

  const context = text.slice(rangeStart, rangeEnd).trim();
  return (context || trimmedFull).slice(0, MAX_CONTEXT_LENGTH);
}

// 主語＋動詞の定型句（例: "I believe"）を置き換える際、主語が落ちて
// "Argue it is..." のようなSV崩壊が起きないよう補正するための主語一覧。
const SUBJECT_PRONOUN_PATTERN = /^(I|we|you|they|he|she|it)\s+/i;

function lowerFirst(value: string): string {
  if (!value) return value;
  // 全て大文字の頭字語（例: "AI"）はそのままにする。
  if (value.length > 1 && value[1] === value[1].toUpperCase() && /[A-Z]/.test(value[1])) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}

/**
 * 置換対象が「主語＋動詞」の句で、置換候補が動詞だけの場合に主語を補う。
 *
 *   preserveSubject("I believe", "argue")   → "I argue"
 *   preserveSubject("I believe", "I argue") → "I argue"（既に主語があるのでそのまま）
 *   preserveSubject("in my opinion", "arguably") → "arguably"（主語を含まないので対象外）
 *
 * コーパスのシードデータ側でも主語付きの候補を持たせているが、AI生成の候補が
 * 動詞単体で返ってきた場合の安全網としてこの関数を通す。
 */
export function preserveSubject(original: string, replacement: string): string {
  const match = original.match(SUBJECT_PRONOUN_PATTERN);
  if (!match) return replacement;

  const subject = match[1];
  const trimmed = replacement.trim();
  if (!trimmed) return replacement;

  // 既に同じ主語で始まっている場合は何もしない。
  if (new RegExp(`^${subject}\\b`, "i").test(trimmed)) return trimmed;

  // 主語を補うので、続く動詞は文中扱いにして先頭を小文字へ戻す。
  return `${subject} ${lowerFirst(trimmed)}`;
}

export function matchCase(source: string, target: string): string {
  if (!source) return target;

  const isAllUpper = source === source.toUpperCase() && source !== source.toLowerCase();
  if (isAllUpper) return target.toUpperCase();

  const isCapitalized = source[0] === source[0].toUpperCase();
  if (isCapitalized) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }

  return target;
}
