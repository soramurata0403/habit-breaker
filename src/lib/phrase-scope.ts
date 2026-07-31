/**
 * 誤り修正の「置換範囲（スコープ）」が安全かどうかを判定する。
 *
 * 句レベルの修正は "am believing" → "believe" のように、be動詞・助動詞と
 * 一体で直さないと文法が壊れるケースのために用意したもの。
 * しかしAIが範囲を広く取りすぎると、対象語と無関係な動詞や目的語まで
 * 置換範囲に含まれ、適用時にそれらが消えてしまう。
 *
 *   誤: word="wrong", phrase="affect everyone wrong", correction="incorrectly"
 *       → "will affect everyone wrong" が "will incorrectly" になってしまう
 *
 * そこで「対象語そのもの」と「それに付随する機能語（be動詞・助動詞・否定語）」
 * だけで句が構成されている場合に限り、句スコープでの置換を許可する。
 * 内容語（他の動詞・名詞など）が混ざっていれば安全でないと判断する。
 *
 * サーバー（/api/text-scan）とクライアント（トークナイザ）の両方から使い、
 * どちらの層でも範囲外の巻き込み削除が起きないようにする。
 */

/** 対象語と一緒に置換してよい機能語。 */
const ATTACHABLE_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  // be動詞
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  // 助動詞
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "can",
  "could",
  "may",
  "might",
  "must",
  // 否定・不定詞
  "not",
  "never",
  "to",
  // 短縮形の助動詞。"didn't decided" → "didn't decide" のように、
  // 助動詞とセットで直すケースを句スコープとして扱えるようにする。
  "don't",
  "doesn't",
  "didn't",
  "won't",
  "can't",
  "cannot",
  "couldn't",
  "shouldn't",
  "wouldn't",
  "mustn't",
  "isn't",
  "aren't",
  "wasn't",
  "weren't",
  "hasn't",
  "haven't",
  "hadn't",
]);

/** 句として許容する最大語数（これを超える範囲は無条件で安全でないとみなす）。 */
const MAX_PHRASE_WORDS = 4;

/** 言い換え（style）で許容する最大語数。"at around" のような短い言い回しのみ。 */
const MAX_STYLE_PHRASE_WORDS = 3;

/** 記号の指摘で許容する最大文字数（"!!" や "..." 程度を想定）。 */
const MAX_SYMBOL_LENGTH = 8;

function toWords(value: string): string[] {
  return value.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? [];
}

/**
 * `phrase` を置換範囲として使ってよいかを判定する。
 * - phrase が対象語1語だけ → 常に安全
 * - phrase が「機能語 + 対象語」の組み合わせだけ → 安全（例: "am believing"）
 * - それ以外（他の内容語を含む） → 安全でない
 */
export function isSafePhraseScope(word: string, phrase: string): boolean {
  const target = word.trim().toLowerCase();
  if (!target) return false;

  const words = toWords(phrase);
  if (words.length === 0 || words.length > MAX_PHRASE_WORDS) return false;

  const targetIndex = words.indexOf(target);
  if (targetIndex === -1) return false;

  // 対象語以外はすべて機能語でなければならない。
  return words.every((candidate, index) =>
    index === targetIndex ? true : ATTACHABLE_FUNCTION_WORDS.has(candidate),
  );
}

export type IssueSeverity = "error" | "style";

// 冠詞・所有格・指示詞。名詞の前にこれらが既にある場合、さらに冠詞を
// 足す提案（"lesson" → "a lesson"）を適用すると "a a lesson" になってしまう。
const DETERMINERS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "the",
  "my",
  "your",
  "his",
  "her",
  "its",
  "our",
  "their",
  "this",
  "that",
  "these",
  "those",
]);

/** 文字列が冠詞・限定詞で始まっていればその語を返す。 */
function leadingDeterminer(value: string): string | null {
  const match = value.trim().toLowerCase().match(/^([a-z]+)\b/);
  return match && DETERMINERS.has(match[1]) ? match[1] : null;
}

/** 直前のテキストが冠詞・限定詞で終わっているか（末尾の空白は無視）。 */
export function endsWithDeterminer(precedingText: string): boolean {
  const match = precedingText.toLowerCase().match(/([a-z]+)\s*$/);
  return Boolean(match && DETERMINERS.has(match[1]));
}

/** correction が、元の phrase に無かった冠詞・限定詞を新たに前置しているか。 */
export function addsLeadingDeterminer(phrase: string, correction: string): boolean {
  return leadingDeterminer(correction) !== null && leadingDeterminer(phrase) === null;
}

/**
 * その置換を適用すると冠詞が重複するか。
 * "I took a lesson" の "lesson" に "a lesson" を当てると "a a lesson" になる。
 */
export function wouldDuplicateDeterminer(
  precedingText: string,
  phrase: string,
  correction: string,
): boolean {
  return addsLeadingDeterminer(phrase, correction) && endsWithDeterminer(precedingText);
}

/**
 * 置換範囲を単語1語に狭めた際、修正案の先頭に「直前に既にある語」が
 * 含まれていると重複してしまうため、その分を取り除く。
 *
 *   直前 "I didn't " + correction "didn't decide" → "decide"
 *   （そのまま当てると "I didn't didn't decide" になってしまう）
 */
export function dropDuplicatedLeadingWords(
  precedingText: string,
  correction: string,
): string {
  let remaining = correction.trim();
  let before = precedingText;

  // 先頭の語が直前のテキストの末尾と一致する限り、繰り返し取り除く。
  for (;;) {
    const head = remaining.match(/^([A-Za-z]+(?:['’][A-Za-z]+)?)\b/);
    if (!head) return remaining;

    const tail = before.match(/([A-Za-z]+(?:['’][A-Za-z]+)?)\s*$/);
    if (!tail || tail[1].toLowerCase() !== head[1].toLowerCase()) return remaining;

    const next = remaining.slice(head[1].length).trimStart();
    if (!next) return remaining;
    remaining = next;
    before = before.slice(0, before.length - tail[0].length);
  }
}

/** 対象と修正案が同一で、適用しても何も変わらない無意味な提案か。 */
export function isNoOpCorrection(phrase: string, correction: string): boolean {
  return phrase.trim() === correction.trim();
}

/** 語の重複除去などで許容する最大語数。 */
const MAX_SUBSEQUENCE_PHRASE_WORDS = 6;

/**
 * correction の語が phrase の語の「部分列」になっているか
 * （＝語を取り除いただけで、新しい内容語を持ち込んでいないか）。
 *
 *   "at around at" → "at around"  : true（重複した at を消しただけ）
 *   "in in"        → "in"         : true
 *   "tacos. and"   → "tacos, and" : true（語は同じで記号だけが変わる）
 *   "affect everyone wrong" → "incorrectly" : false（新しい語に潰している）
 *
 * 部分列であれば、残る語はすべて元の文にあった語なので、
 * 周囲の内容語を巻き込んで消してしまう心配がない。
 */
function isWordSubsequence(phraseWords: string[], correctionWords: string[]): boolean {
  if (correctionWords.length > phraseWords.length) return false;
  let cursor = 0;
  for (const word of correctionWords) {
    const found = phraseWords.indexOf(word, cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}

/** 文字（アルファベット）を含まない＝記号だけの指摘かどうか。 */
export function isSymbolOnly(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/[A-Za-z]/.test(trimmed);
}

/**
 * 指摘の置換範囲が安全かどうかを、種別ごとの基準で判定する。
 *
 * - 記号の指摘（"!!" → "."）: word と phrase が同一の短い記号列であること
 * - style（言い換え）: "at around" → "at approximately" のように、
 *   短いかたまりが同程度の長さの表現に1対1で置き換わること。
 *   周囲の内容語を巻き込んで短い語へ潰す指定は弾く。
 * - error（文法・表記の誤り）: 対象語1語、または対象語＋機能語のみ
 */
export function isSafeReplacementScope(issue: {
  word: string;
  phrase: string;
  correction: string;
  severity: IssueSeverity;
}): boolean {
  const word = issue.word.trim();
  const phrase = issue.phrase.trim();
  if (!word || !phrase) return false;

  // 記号の指摘は、その記号だけを対象にしている場合のみ許可する。
  if (isSymbolOnly(phrase)) {
    return (
      isSymbolOnly(word) && word === phrase && phrase.length <= MAX_SYMBOL_LENGTH
    );
  }

  const phraseWords = toWords(phrase);
  const correctionWords = toWords(issue.correction);
  const targetWord = word.toLowerCase();
  const containsTarget = phraseWords.includes(targetWord);

  // 語を取り除くだけの修正（重複した前置詞の削除、記号の差し替えなど）と、
  // 語を挿入するだけの修正（冠詞の補い "took lesson" → "took a lesson" など）は、
  // 元の語がすべて残るため範囲が多少広くても安全。
  if (
    phraseWords.length > 0 &&
    phraseWords.length <= MAX_SUBSEQUENCE_PHRASE_WORDS &&
    containsTarget &&
    (isWordSubsequence(phraseWords, correctionWords) ||
      isWordSubsequence(correctionWords, phraseWords))
  ) {
    return true;
  }

  // コロケーションの入れ替え（"take Baptism" → "get baptized" など）。
  // 対象語が句の**先頭**にある場合に限り、同程度の長さへの置き換えを許可する。
  // 先頭に限定しているのは、"everyone wrong" → "incorrectly" のように
  // 対象語の手前にある内容語を巻き込んで潰す指定を防ぐため。
  if (
    phraseWords.length > 1 &&
    phraseWords.length <= MAX_STYLE_PHRASE_WORDS &&
    phraseWords[0] === targetWord &&
    correctionWords.length > 0 &&
    Math.abs(phraseWords.length - correctionWords.length) <= 1
  ) {
    return true;
  }

  if (issue.severity === "style") {
    if (phraseWords.length === 0 || phraseWords.length > MAX_STYLE_PHRASE_WORDS) return false;
    if (correctionWords.length === 0) return false;
    if (!phraseWords.includes(word.toLowerCase())) return false;
    // 語数が大きく変わる指定は、周囲の語を巻き込んで潰している疑いがある。
    return Math.abs(phraseWords.length - correctionWords.length) <= 1;
  }

  return isSafePhraseScope(word, phrase);
}
