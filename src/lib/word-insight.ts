import { contextualPronouns, habitRuleMap, type Suggestion } from "@/data/habit-rules";
import { isNoOpCorrection } from "@/lib/phrase-scope";
import {
  applySenseToRule,
  filterSuggestionsForSense,
  resolveWordSense,
  type WordSense,
} from "@/lib/polysemy";
import { genericSynonymMap } from "@/data/generic-synonyms";

export type WordInsightSource =
  | "corpus"
  | "ai"
  | "generic"
  | "unknown"
  | "typo-local"
  // 多義語の品詞を判定した結果、言い換えの対象にならないと分かった場合。
  | "sense";

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
  sense?: WordSense | null,
): Promise<WordInsight | null> {
  try {
    const response = await fetch("/api/word-insight", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // senseId を渡すと、サーバー側で「その品詞に一致する候補だけを出す」
      // 制約をプロンプトに載せ、外れた候補を除外してくれる。
      body: JSON.stringify({
        word,
        contextSentence,
        documentText,
        ...(sense ? { senseId: sense.id } : {}),
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as ApiSuccessResponse;
    if (typeof data.explanation !== "string" || data.explanation.trim().length === 0) {
      return null;
    }

    // 品詞が確定している多義語では、その品詞に合わない候補をここでも落とす。
    // 全て落ちた場合は、その品詞に一致する既定の候補に差し替える。
    let suggestions = normalizeCandidates(data.candidates);
    if (sense) {
      suggestions = filterSuggestionsForSense(sense, suggestions);
      if (suggestions.length === 0) suggestions = sense.suggestions;
    }

    // we/us/our が「具体的な人物を指す適切な用法」だとAIが確認した場合は、
    // 言い換え候補が0件でも正常な応答として扱う（言い換えの必要がないため）。
    const isContextualPronoun = contextualPronouns.has(word.toLowerCase());
    const isConfirmedFinePronoun = isContextualPronoun && data.isVaguePronoun === false;

    // 多義語で候補が全て弾かれた場合も、解説だけは表示する価値がある。
    if (suggestions.length === 0 && !isConfirmedFinePronoun && !sense) return null;

    const isTypo =
      data.isTypo === true &&
      typeof data.suggestedSpelling === "string" &&
      data.suggestedSpelling.trim().length > 0;

    return {
      // 呼び出し側は小文字の見出し語で照合するため、ここでも小文字に揃える
      // （"As" のように文頭で大文字になっている語でも解説を表示できるように）。
      word: word.toLowerCase(),
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
  /** 誤りの中心となる単語（ハイライト対象）。 */
  word: string;
  /** 置換対象の原文の範囲。単語1語のこともあれば "am believing" のような句のこともある。 */
  phrase: string;
  /** phrase を置き換える正しい表現。 */
  correction: string;
  explanation: string;
  /** error = 文法・表記の誤り（赤）／ style = 口語的な表現の言い換え（黄） */
  severity: "error" | "style";
};

type ScanApiResponse = { issues?: unknown };

/**
 * `didRequest` は「実際にサーバーへリクエストを送り、正常な応答を受け取った」
 * ことを表す。利用回数はこれが true の場合にのみ消費する（通信していない場合や
 * エラー・レート制限で弾かれた場合は消費しない）。
 */
export type ScanOutcome = { didRequest: boolean; issues: ContextualTypo[] };

/**
 * /api/text-scan を呼び出し、文章全体から「実在するが文脈上明らかに
 * 誤りである単語（例: leaned → learned）」を検出する。
 * ネットワークエラー・APIキー未設定などの場合は空配列を返し、
 * 呼び出し側は単に「今回は検出結果なし」として扱えるようにする。
 */
export async function scanTextForContextualTypos(text: string): Promise<ScanOutcome> {
  if (!text.trim()) return { didRequest: false, issues: [] };

  try {
    const response = await fetch("/api/text-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) return { didRequest: false, issues: [] };

    const data = (await response.json()) as ScanApiResponse;
    if (!Array.isArray(data.issues)) return { didRequest: true, issues: [] };

    const issues = data.issues
      .filter((item): item is ContextualTypo => {
        if (!item || typeof item !== "object") return false;
        const t = item as Record<string, unknown>;
        return (
          typeof t.word === "string" &&
          typeof t.phrase === "string" &&
          typeof t.correction === "string" &&
          typeof t.explanation === "string"
        );
      })
      // 適用しても内容が変わらない提案（"a" → "a" など）はここでも落とす。
      .filter((item) => !isNoOpCorrection(item.phrase, item.correction))
      .map((item) => ({
        word: item.word,
        phrase: item.phrase,
        correction: item.correction,
        explanation: item.explanation,
        // severity が欠けていても指摘を捨てず、誤り（赤）として扱う。
        severity: item.severity === "style" ? ("style" as const) : ("error" as const),
      }));

    return { didRequest: true, issues };
  } catch (error) {
    console.error("Failed to scan text for contextual issues:", error);
    return { didRequest: false, issues: [] };
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
 * 多義語のうち「言い換えの対象にならない用法」（"so that" / "as well as" など）も
 * 文脈から機械的に判定できるので通信は不要。
 */
export function requiresApiCall(
  rawWord: string,
  documentText?: string,
  position?: number,
): boolean {
  if (habitRuleMap.has(rawWord.toLowerCase())) return false;
  return !resolveSense(rawWord, documentText, position)?.suppress;
}

function resolveSense(
  rawWord: string,
  documentText?: string,
  position?: number,
): WordSense | null {
  if (typeof documentText !== "string" || typeof position !== "number") return null;
  return resolveWordSense(rawWord, documentText, position);
}

/**
 * 単語ごとの解説・言い換え候補を取得するフック。
 *
 * 優先順位:
 *   0. 多義語（so / like / well / as）の品詞判定 — 出せる候補を品詞に合わせて絞る
 *   1. コーパスルール（静的シードデータ）— 通信不要で即座に返す
 *   2. /api/word-insight（gpt-4o-miniによる文脈に応じたリアルタイム生成）
 *   3. ローカル汎用辞書 → 「データ準備中」表示（APIキー未設定・通信エラー時の安全なフォールバック）
 *
 * `position` には文章中でのその語の開始位置を渡す。多義語の品詞判定
 * （"so ugly" の so は副詞、"…, so we left" の so は接続詞）に使う。
 */
export async function fetchWordInsight(
  rawWord: string,
  contextSentence?: string,
  documentText?: string,
  position?: number,
): Promise<WordInsight> {
  const word = rawWord.toLowerCase();
  const sense = resolveSense(rawWord, documentText, position);

  const corpusRule = habitRuleMap.get(word);
  if (corpusRule) {
    const senseRule = applySenseToRule(corpusRule, sense);
    if (!senseRule) {
      // "so that" のように、その用法では言い換えの対象にならない場合。
      return {
        word: corpusRule.word,
        source: "sense",
        badgeLabel: "用法の確認",
        insight: sense?.insight ?? corpusRule.insight,
        suggestions: [],
      };
    }
    return {
      word: senseRule.word,
      source: "corpus",
      badgeLabel: "オーバーユース単語",
      insight: senseRule.insight,
      suggestions: senseRule.suggestions,
    };
  }

  // 固定表現の一部（"as well as" など）は通信せずその旨だけを伝える。
  if (sense?.suppress) {
    return {
      word,
      source: "sense",
      badgeLabel: "用法の確認",
      insight: sense.insight,
      suggestions: [],
    };
  }

  const aiInsight = await fetchFromApi(
    rawWord,
    contextSentence?.trim() || rawWord,
    documentText,
    sense,
  );
  if (aiInsight) return aiInsight;

  // 多義語で候補が1つも残らなかった場合は、汎用辞書ではなく用法の解説を返す。
  if (sense) {
    return {
      word,
      source: "sense",
      badgeLabel: "用法の確認",
      insight: sense.insight,
      suggestions: sense.suggestions,
    };
  }

  return localFallback(rawWord, word);
}
