import type { Token } from "@/lib/tokenize";

export type IssueItem = {
  id: number;
  // 対応する word トークンの key。一覧をクリックした際に、本文中の
  // 同じ単語のポップオーバー（解説・言い換え候補）を開くために使う。
  tokenKey: string;
  word: string;
  detail: string;
};

/**
 * トークン列から、サイドパネルに一覧表示する「改善ポイント」と
 * 「スペルミスの疑い」をそれぞれ抽出する。id にはトークンの開始位置
 * （start）を使い、本文中のハイライト要素（id={`token-${start}`}）への
 * ジャンプに利用する。
 */
export function buildIssueItems(tokens: Token[]): {
  improvements: IssueItem[];
  spelling: IssueItem[];
} {
  const improvements: IssueItem[] = [];
  const spelling: IssueItem[] = [];

  for (const token of tokens) {
    if (token.type !== "word") continue;

    if (token.rule) {
      improvements.push({
        id: token.start,
        tokenKey: token.key,
        word: token.text,
        detail: token.occurrenceCount
          ? `この文章内で${token.occurrenceCount}回使われています。言い換えを検討しましょう。`
          : token.rule.insight,
      });
      continue;
    }

    if (token.isAiTypo || token.isUnknownWord) {
      spelling.push({
        id: token.start,
        tokenKey: token.key,
        word: token.text,
        detail:
          token.isAiTypo && token.aiSuggestedSpelling
            ? `もしかして: "${token.aiSuggestedSpelling}"`
            : "辞書に見つからない単語です。スペルミスの可能性があります。",
      });
    }
  }

  return { improvements, spelling };
}
