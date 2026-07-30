import { habitRuleMap, phraseHabitRules, type HabitRule } from "@/data/habit-rules";
import { isUnknownWord } from "@/lib/spellcheck";

export type AiTypoInfo = {
  suggestedSpelling: string;
  explanation: string;
};

export type Token =
  | {
      type: "text";
      key: string;
      text: string;
    }
  | {
      type: "word";
      key: string;
      text: string;
      start: number;
      end: number;
      rule?: HabitRule;
      isUnknownWord?: boolean;
      isAiTypo?: boolean;
      aiSuggestedSpelling?: string;
      aiExplanation?: string;
    };

const SENTENCE_END_PATTERN = /[.!?]/;
const WORD_PATTERN = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

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

export function tokenize(text: string, dictionary?: Set<string> | null): Token[] {
  const tokens: Token[] = [];
  const phraseSpans = findPhraseSpans(text);
  let phraseIndex = 0;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let atSentenceStart = true;
  WORD_PATTERN.lastIndex = 0;

  function flushGap(upTo: number) {
    if (upTo > lastIndex) {
      const gap = text.slice(lastIndex, upTo);
      tokens.push({ type: "text", key: `t-${lastIndex}`, text: gap });
      if (SENTENCE_END_PATTERN.test(gap)) atSentenceStart = true;
    }
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

    const rule = habitRuleMap.get(word.toLowerCase());
    tokens.push({
      type: "word",
      key: `w-${start}`,
      text: word,
      start,
      end,
      rule,
      isUnknownWord:
        !rule && dictionary ? isUnknownWord(word, atSentenceStart, dictionary) : false,
    });

    atSentenceStart = false;
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: "text",
      key: `t-${lastIndex}`,
      text: text.slice(lastIndex),
    });
  }

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
): Token[] {
  if (aiTypos.size === 0) return tokens;

  return tokens.map((token) => {
    if (token.type !== "word" || token.rule) return token;

    const match = aiTypos.get(token.text.toLowerCase());
    if (!match) return token;

    return {
      ...token,
      isAiTypo: true,
      aiSuggestedSpelling: match.suggestedSpelling,
      aiExplanation: match.explanation,
    };
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
