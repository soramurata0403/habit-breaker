import { contextualPronouns, habitRuleMap, type Suggestion } from "@/data/habit-rules";
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
  isVaguePronoun?: boolean;
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
  isVaguePronoun?: unknown;
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
  documentText?: string,
): Promise<WordInsight | null> {
  try {
    const response = await fetch("/api/word-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word, contextSentence, documentText }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ApiSuccessResponse;
    if (typeof data.explanation !== "string" || data.explanation.trim().length === 0) {
      return null;
    }

    const suggestions = normalizeCandidates(data.candidates);

    // we/us/our が「具体的な人物を指す適切な用法」だとAIが確認した場合は、
    // 言い換え候補が0件でも正常な応答として扱う（言い換えの必要がないため）。
    const isContextualPronoun = contextualPronouns.has(word.toLowerCase());
    const isConfirmedFinePronoun = isContextualPronoun && data.isVaguePronoun === false;

    if (suggestions.length === 0 && !isConfirmedFinePronoun) return null;

    const isTypo =
      data.isTypo === true &&
      typeof data.suggestedSpelling === "string" &&
      data.suggestedSpelling.trim().length > 0;

    return {
      word,
      source: "ai",
      badgeLabel: "解説",
      insight: data.explanation,
      suggestions,
      ...(isTypo
        ? { isTypo: true, suggestedSpelling: (data.suggestedSpelling as string).trim() }
        : {}),
      ...(isContextualPronoun ? { isVaguePronoun: data.isVaguePronoun === true } : {}),
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

export type ContextualTypo = {
  word: string;
  suggestedSpelling: string;
  explanation: string;
};

type ScanApiResponse = { typos?: unknown };

/**
 * `didRequest` は「実際にサーバーへリクエストを送り、正常な応答を受け取った」
 * ことを表す。利用回数はこれが true の場合にのみ消費する（通信していない場合や
 * エラー・レート制限で弾かれた場合は消費しない）。
 */
export type ScanOutcome = { didRequest: boolean; typos: ContextualTypo[] };

/**
 * /api/text-scan を呼び出し、文章全体から「実在するが文脈上明らかに
 * 誤りである単語（例: leaned → learned）」を検出する。
 * ネットワークエラー・APIキー未設定などの場合は空配列を返し、
 * 呼び出し側は単に「今回は検出結果なし」として扱えるようにする。
 */
export async function scanTextForContextualTypos(text: string): Promise<ScanOutcome> {
  if (!text.trim()) return { didRequest: false, typos: [] };

  try {
    const response = await fetch("/api/text-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) return { didRequest: false, typos: [] };

    const data = (await response.json()) as ScanApiResponse;
    if (!Array.isArray(data.typos)) return { didRequest: true, typos: [] };

    const typos = data.typos
      .filter(
        (item): item is { word: string; suggestedSpelling: string; explanation: string } => {
          if (!item || typeof item !== "object") return false;
          const t = item as Record<string, unknown>;
          return (
            typeof t.word === "string" &&
            typeof t.suggestedSpelling === "string" &&
            typeof t.explanation === "string"
          );
        },
      )
      .map((item) => ({
        word: item.word,
        suggestedSpelling: item.suggestedSpelling,
        explanation: item.explanation,
      }));

    return { didRequest: true, typos };
  } catch (error) {
    console.error("Failed to scan text for contextual typos:", error);
    return { didRequest: false, typos: [] };
  }
}

export type PronounOccurrence = {
  id: number;
  word: string;
  sentence: string;
};

type PronounContextApiResponse = { results?: unknown };

/**
 * /api/pronoun-context を呼び出し、文章中の we/us/our の各出現箇所について、
 * 「人々全般」を指す曖昧な用法かどうかをAIに判定させる。
 * `id` には呼び出し側で単語トークンの開始位置などの安定した識別子を渡す。
 * `documentText` には文章全体を渡し、個人的な体験談かアカデミックな論説文かの
 * トーン判定に使う（個人的な体験談の場合、we/us/our は一律で誤検出対象外になる）。
 * ネットワークエラー・APIキー未設定などの場合は空集合を返し、
 * 呼び出し側は「今回は曖昧な用法なし」として扱えるようにする。
 */
export type PronounContextOutcome = { didRequest: boolean; vagueIds: Set<number> };

export async function checkPronounContext(
  occurrences: PronounOccurrence[],
  documentText: string,
): Promise<PronounContextOutcome> {
  if (occurrences.length === 0) return { didRequest: false, vagueIds: new Set() };

  try {
    const response = await fetch("/api/pronoun-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: documentText, occurrences }),
    });

    if (!response.ok) return { didRequest: false, vagueIds: new Set() };

    const data = (await response.json()) as PronounContextApiResponse;
    if (!Array.isArray(data.results)) return { didRequest: true, vagueIds: new Set() };

    const vagueIds = data.results
      .filter((item): item is { id: number; isVague: boolean } => {
        if (!item || typeof item !== "object") return false;
        const r = item as Record<string, unknown>;
        return typeof r.id === "number" && typeof r.isVague === "boolean";
      })
      .filter((item) => item.isVague)
      .map((item) => item.id);

    return { didRequest: true, vagueIds: new Set(vagueIds) };
  } catch (error) {
    console.error("Failed to check pronoun context:", error);
    return { didRequest: false, vagueIds: new Set() };
  }
}

/**
 * その単語の解説を出すのに /api/word-insight（＝OpenAI呼び出し）が必要かどうか。
 * コーパスルールに載っている単語は通信せず即座に返せるため、
 * 利用回数のカウント対象から除外できる。
 */
export function requiresApiCall(rawWord: string): boolean {
  return !habitRuleMap.has(rawWord.toLowerCase());
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
  documentText?: string,
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

  const aiInsight = await fetchFromApi(rawWord, contextSentence?.trim() || rawWord, documentText);
  if (aiInsight) return aiInsight;

  return localFallback(rawWord, word);
}
