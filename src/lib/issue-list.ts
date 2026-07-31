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
export function buildIssueItems(
  tokens: Token[],
  text: string,
): {
  improvements: IssueItem[];
  spelling: IssueItem[];
} {
  const improvements: IssueItem[] = [];
  const spelling: IssueItem[] = [];

  /** その指摘で実際に置き換えられる原文の範囲。 */
  const phraseOf = (token: Extract<Token, { type: "word" }>) =>
    token.aiReplaceStart !== undefined && token.aiReplaceEnd !== undefined
      ? text.slice(token.aiReplaceStart, token.aiReplaceEnd)
      : token.text;

  for (const token of tokens) {
    if (token.type !== "word") continue;

    // 口語表現の言い換え提案（黄色）も改善ポイントとして一覧に載せる。
    if (token.isAiStyle) {
      improvements.push({
        id: token.start,
        tokenKey: token.key,
        word: token.text,
        detail: token.aiCorrection
          ? `より硬い表現に: "${token.aiCorrection}"`
          : (token.aiExplanation ?? "アカデミックな表現への言い換えを検討しましょう。"),
      });
      continue;
    }

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
        // 句レベルの修正（例: "a a" → "a"）では、単語だけを見せると
        // 「a → a」のように無意味な提案に見えてしまうため、
        // 置換される範囲そのものを表示する。
        detail:
          token.isAiTypo && token.aiCorrection
            ? phraseOf(token) && phraseOf(token) !== token.text
              ? `"${phraseOf(token)}" → "${token.aiCorrection}"`
              : `もしかして: "${token.aiCorrection}"`
            : "辞書に見つからない単語です。スペルミスの可能性があります。",
      });
    }
  }

  return { improvements, spelling };
}
