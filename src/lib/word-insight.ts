import { habitRuleMap, type Suggestion } from "@/data/habit-rules";
import { genericSynonymMap } from "@/data/generic-synonyms";

export type WordInsightSource = "corpus" | "ai" | "generic" | "unknown" | "typo-local";

export type WordInsight = {
  word: string;
  source: WordInsightSource;
  badgeLabel: string;
  insight: string;
  suggestions: Suggestion[];
  isTypo?: boolean;
  suggestedSpelling?: string;
};

function guessPartOfSpeech(word: string): string {
  if (/ly$/.test(word)) return "副詞";
  if (/(tion|sion|ment|ness|ity)$/.test(word)) return "名詞";
  if (/(ful|ous|ive|able|ible|al)$/.test(word)) return "形容詞";
  if (/(ing|ed)$/.test(word)) return "動詞";
  return "単語";
}

type ApiCandidate = { word?: unknown; nuance?: unknown };
type ApiSuccessResponse = {
  explanation?: unknown;
  candidates?: unknown;
  isTypo?: unknown;
  suggestedSpelling?: unknown;
};

function normalizeCandidates(candidates: unknown): Suggestion[] {
  if (!Array.isArray(candidates)) return [];
  return candidates
    .filter((candidate): candidate is { word: string; nuance: string } => {
      if (!candidate || typeof candidate !== "object") return false;
      const c = candidate as ApiCandidate;
      return typeof c.word === "string" && typeof c.nuance === "string";
    })
    .map((candidate) => ({ word: candidate.word, nuance: candidate.nuance }));
}

/**
 * /api/word-insight（gpt-4o-miniによるリアルタイム生成）を呼び出す。
 * ネットワークエラー・APIキー未設定・不正なレスポンスなど、
 * 何らかの理由で取得できなかった場合は null を返し、呼び出し側で
 * ローカルフォールバックに切り替えられるようにする。
 */
async function fetchFromApi(
  word: string,
  contextSentence: string,
): Promise<WordInsight | null> {
  try {
    const response = await fetch("/api/word-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, contextSentence }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ApiSuccessResponse;
    if (typeof data.explanation !== "string" || data.explanation.trim().length === 0) {
      return null;
    }

    const suggestions = normalizeCandidates(data.candidates);
    if (suggestions.length === 0) return null;

    const isTypo =
      data.isTypo === true &&
      typeof data.suggestedSpelling === "string" &&
      data.suggestedSpelling.trim().length > 0;

    return {
      word,
      source: "ai",
      badgeLabel: "AIによる解説",
      insight: data.explanation,
      suggestions,
      ...(isTypo
        ? { isTypo: true, suggestedSpelling: (data.suggestedSpelling as string).trim() }
        : {}),
    };
  } catch {
    // ネットワークエラー・タイムアウトなど。呼び出し側でフォールバックする。
    return null;
  }
}

function localFallback(rawWord: string, word: string): WordInsight {
  const genericSuggestions = genericSynonymMap.get(word);
  if (genericSuggestions) {
    return {
      word,
      source: "generic",
      badgeLabel: "言い換え候補",
      insight: `"${rawWord}" は文脈によって、より具体的な${guessPartOfSpeech(
        word,
      )}に言い換えると表現の幅が広がります。`,
      suggestions: genericSuggestions,
    };
  }

  return {
    word,
    source: "unknown",
    badgeLabel: "データ準備中",
    insight: `"${rawWord}" の解説を取得できませんでした。AI連携が利用できない可能性があります。しばらくしてからもう一度お試しください。`,
    suggestions: [],
  };
}

/**
 * 単語ごとの解説・言い換え候補を取得するフック。
 *
 * 優先順位:
 *   1. コーパスルール（静的シードデータ）— 通信不要で即座に返す
 *   2. /api/word-insight（gpt-4o-miniによる文脈に応じたリアルタイム生成）
 *   3. ローカル汎用辞書 → 「データ準備中」表示（APIキー未設定・通信エラー時の安全なフォールバック）
 */
export async function fetchWordInsight(
  rawWord: string,
  contextSentence?: string,
): Promise<WordInsight> {
  const word = rawWord.toLowerCase();

  const corpusRule = habitRuleMap.get(word);
  if (corpusRule) {
    return {
      word: corpusRule.word,
      source: "corpus",
      badgeLabel: "オーバーユース単語",
      insight: corpusRule.insight,
      suggestions: corpusRule.suggestions,
    };
  }

  const aiInsight = await fetchFromApi(rawWord, contextSentence?.trim() || rawWord);
  if (aiInsight) return aiInsight;

  return localFallback(rawWord, word);
}
