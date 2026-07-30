import { habitRuleMap, type Suggestion } from "@/data/habit-rules";
import { genericSynonymMap } from "@/data/generic-synonyms";

export type WordInsightSource = "corpus" | "generic" | "unknown";

export type WordInsight = {
  word: string;
  source: WordInsightSource;
  badgeLabel: string;
  insight: string;
  suggestions: Suggestion[];
};

function guessPartOfSpeech(word: string): string {
  if (/ly$/.test(word)) return "副詞";
  if (/(tion|sion|ment|ness|ity)$/.test(word)) return "名詞";
  if (/(ful|ous|ive|able|ible|al)$/.test(word)) return "形容詞";
  if (/(ing|ed)$/.test(word)) return "動詞";
  return "単語";
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * 単語ごとの解説・言い換え候補を取得するフック。
 *
 * 優先順位: コーパスルール（静的シードデータ）→ 汎用シノニム辞書 → 未登録。
 * 実プロダクトでは、このコーパスルール以外の分岐（generic / unknown）を
 * 外部の類語辞書API・LLM呼び出しに差し替えることを想定している。
 * ここでは疑似的なネットワーク遅延を挟んだモック実装としている。
 */
export async function fetchWordInsight(rawWord: string): Promise<WordInsight> {
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

  // TODO: 実運用では、ここを言い換え辞書API・LLM呼び出しに置き換える。
  await delay(350);

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
    insight: `"${rawWord}" はまだ辞書に登録されていません。今後はAPI / LLM連携により、文脈に応じた解説と言い換え候補をリアルタイムに生成する予定です。`,
    suggestions: [],
  };
}
