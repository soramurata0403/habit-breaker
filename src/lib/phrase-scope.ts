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
