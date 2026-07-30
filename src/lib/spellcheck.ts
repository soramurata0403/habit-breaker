const DICTIONARY_URL = "/dictionary/en-words.txt";

let dictionaryPromise: Promise<Set<string> | null> | null = null;

/**
 * 英単語辞書（約27万語、/public/dictionary/en-words.txt）を一度だけ取得し、
 * 以降はメモリ上にキャッシュする。取得に失敗した場合は null を返し、
 * 呼び出し側はスペルチェックを（誤検知を出すより）スキップできるようにする。
 */
export function loadDictionary(): Promise<Set<string> | null> {
  if (!dictionaryPromise) {
    dictionaryPromise = fetch(DICTIONARY_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load dictionary: ${response.status}`);
        }
        return response.text();
      })
      .then((text) => {
        const words = text
          .split("\n")
          .map((word) => word.trim().toLowerCase())
          .filter(Boolean);
        return new Set(words);
      })
      .catch((error: unknown) => {
        console.error("Failed to load spellcheck dictionary:", error);
        dictionaryPromise = null;
        return null;
      });
  }
  return dictionaryPromise;
}

/**
 * 固有名詞・略語・短縮形など、スペルチェックの対象から除外すべき語を判定する。
 * `isSentenceStart` は、この単語が文頭（＝大文字化されているのが単に
 * 文法上の理由である可能性が高い）かどうか。
 */
export function shouldSkipSpellcheck(word: string, isSentenceStart: boolean): boolean {
  if (word.length <= 1) return true;
  if (word.includes("'") || word.includes("’")) return true; // 短縮形・所有格

  const isAllUpper = word === word.toUpperCase() && word !== word.toLowerCase();
  if (isAllUpper) return true; // 略語（BYU, IELTS, TOEFL など）

  const isCapitalized =
    word[0] === word[0].toUpperCase() && word.slice(1) === word.slice(1).toLowerCase();
  if (isCapitalized && !isSentenceStart) return true; // 固有名詞と推定

  return false;
}

/**
 * 辞書に存在しない語（＝スペルミスの疑いがある語）かどうかを判定する。
 */
export function isUnknownWord(
  word: string,
  isSentenceStart: boolean,
  dictionary: Set<string>,
): boolean {
  if (shouldSkipSpellcheck(word, isSentenceStart)) return false;
  if (!/^[a-zA-Z]+$/.test(word)) return false;
  return !dictionary.has(word.toLowerCase());
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

/** Peter Norvig 方式の編集距離1の候補生成（削除・入替・置換・挿入）。 */
function edits1(word: string): Set<string> {
  const results = new Set<string>();

  for (let i = 0; i <= word.length; i++) {
    const left = word.slice(0, i);
    const right = word.slice(i);

    if (right.length > 0) {
      results.add(left + right.slice(1));
    }
    if (right.length > 1) {
      results.add(left + right[1] + right[0] + right.slice(2));
    }
    if (right.length > 0) {
      for (const c of ALPHABET) results.add(left + c + right.slice(1));
    }
    for (const c of ALPHABET) results.add(left + c + right);
  }

  results.delete(word);
  return results;
}

const MAX_EDITS2_CANDIDATES = 20000;
const MAX_WORD_LENGTH_FOR_EDITS2 = 10;

/**
 * 辞書ベースの軽量なスペル修正候補の生成。ネットワーク通信を必要とせず、
 * クリック時に同期的に（体感で即座に）候補を返せることを優先している。
 */
export function suggestCorrections(
  word: string,
  dictionary: Set<string>,
  maxSuggestions = 3,
): string[] {
  const lower = word.toLowerCase();

  let pool = [...edits1(lower)].filter((candidate) => dictionary.has(candidate));

  if (pool.length === 0 && lower.length <= MAX_WORD_LENGTH_FOR_EDITS2) {
    const edits2 = new Set<string>();
    outer: for (const e1 of edits1(lower)) {
      for (const e2 of edits1(e1)) {
        edits2.add(e2);
        if (edits2.size > MAX_EDITS2_CANDIDATES) break outer;
      }
    }
    pool = [...edits2].filter((candidate) => dictionary.has(candidate));
  }

  return Array.from(new Set(pool))
    .sort(
      (a, b) =>
        Math.abs(a.length - lower.length) - Math.abs(b.length - lower.length) ||
        a.localeCompare(b),
    )
    .slice(0, maxSuggestions);
}
