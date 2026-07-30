import type { Suggestion } from "./habit-rules";

/**
 * コーパスルール（habit-rules.ts）に登録されていない一般的な単語向けの、
 * 汎用的な言い換え候補の辞書。実プロダクトでは、この辞書の代わりに
 * 外部の類語辞書API・LLMを呼び出す想定（src/lib/word-insight.ts 参照）。
 */
export const genericSynonyms: Record<string, Suggestion[]> = {
  happy: [
    { word: "content", nuance: "満ち足りた" },
    { word: "pleased", nuance: "喜んでいる" },
    { word: "delighted", nuance: "非常に嬉しい" },
  ],
  sad: [
    { word: "disheartened", nuance: "気力を失うほど残念な" },
    { word: "regrettable", nuance: "遺憾な（事柄について）" },
    { word: "unfortunate", nuance: "不運な" },
  ],
  show: [
    { word: "demonstrate", nuance: "実証・実演する" },
    { word: "illustrate", nuance: "具体例で示す" },
    { word: "indicate", nuance: "データなどが示す" },
  ],
  help: [
    { word: "assist", nuance: "手助けする（フォーマル）" },
    { word: "support", nuance: "支援する" },
    { word: "facilitate", nuance: "物事を円滑にする" },
  ],
  use: [
    { word: "utilize", nuance: "効果的に活用する" },
    { word: "employ", nuance: "手段として用いる" },
    { word: "apply", nuance: "適用する" },
  ],
  change: [
    { word: "alter", nuance: "部分的に変更する" },
    { word: "modify", nuance: "調整・修正する" },
    { word: "transform", nuance: "大きく変化させる" },
  ],
  easy: [
    { word: "straightforward", nuance: "分かりやすく単純な" },
    { word: "effortless", nuance: "苦労を要さない" },
    { word: "manageable", nuance: "対処しやすい" },
  ],
  difficult: [
    { word: "challenging", nuance: "やりがいのある困難さ" },
    { word: "demanding", nuance: "多くの労力を要する" },
    { word: "complex", nuance: "複雑な" },
  ],
  said: [
    { word: "stated", nuance: "公式に述べた" },
    { word: "remarked", nuance: "所感を述べた" },
    { word: "noted", nuance: "指摘した" },
  ],
  want: [
    { word: "wish", nuance: "願う" },
    { word: "desire", nuance: "強く望む（フォーマル）" },
    { word: "aim", nuance: "目指す" },
  ],
  need: [
    { word: "require", nuance: "必要とする（フォーマル）" },
    { word: "necessitate", nuance: "必然的に要する" },
    { word: "demand", nuance: "強く必要とする" },
  ],
  know: [
    { word: "understand", nuance: "理解している" },
    { word: "recognize", nuance: "認識している" },
    { word: "realize", nuance: "気づいている" },
  ],
  also: [
    { word: "additionally", nuance: "加えて（文頭で使いやすい）" },
    { word: "furthermore", nuance: "さらに（論理を重ねる）" },
    { word: "moreover", nuance: "その上" },
  ],
  real: [
    { word: "genuine", nuance: "本物の" },
    { word: "authentic", nuance: "真正の" },
    { word: "actual", nuance: "実際の" },
  ],
  interesting: [
    { word: "intriguing", nuance: "興味をそそる" },
    { word: "compelling", nuance: "引き込まれるほど魅力的な" },
    { word: "noteworthy", nuance: "注目に値する" },
  ],
  great: [
    { word: "remarkable", nuance: "際立って優れた" },
    { word: "outstanding", nuance: "傑出した" },
    { word: "exceptional", nuance: "並外れた" },
  ],
};

export const genericSynonymMap: Map<string, Suggestion[]> = new Map(
  Object.entries(genericSynonyms),
);
