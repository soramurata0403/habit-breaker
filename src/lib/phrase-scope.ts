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

  if (issue.severity === "style") {
    const phraseWords = toWords(phrase);
    const correctionWords = toWords(issue.correction);
    if (phraseWords.length === 0 || phraseWords.length > MAX_STYLE_PHRASE_WORDS) return false;
    if (correctionWords.length === 0) return false;
    if (!phraseWords.includes(word.toLowerCase())) return false;
    // 語数が大きく変わる指定は、周囲の語を巻き込んで潰している疑いがある。
    return Math.abs(phraseWords.length - correctionWords.length) <= 1;
  }

  return isSafePhraseScope(word, phrase);
}
