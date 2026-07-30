import type { Suggestion } from "./habit-rules";

/**
 * コーパスルール（habit-rules.ts）に登録されていない一般的な単語向けの、
 * 汎用的な言い換え候補の辞書。実プロダクトでは、この辞書の代わりに
 * 外部の類語辞書API・LLMを呼び出す想定（src/lib/word-insight.ts 参照）。
 */
export const genericSynonyms: Record<string, Suggestion[]> = {
  good: [
    { word: "beneficial", nuance: "利益や効果の観点で良い" },
    { word: "favorable", nuance: "状況や条件が好ましい" },
    { word: "excellent", nuance: "非常に優れている" },
  ],
  big: [
    { word: "substantial", nuance: "量や規模が相当な" },
    { word: "considerable", nuance: "無視できないほど大きい" },
    { word: "significant", nuance: "重要な意味を持つほど大きい" },
  ],
  small: [
    { word: "minor", nuance: "重要度や規模が小さい" },
    { word: "negligible", nuance: "無視できるほど小さい" },
    { word: "modest", nuance: "控えめな規模の" },
  ],
  important: [
    { word: "crucial", nuance: "決定的に重要な" },
    { word: "essential", nuance: "不可欠な" },
    { word: "significant", nuance: "意義が大きい" },
  ],
  get: [
    { word: "obtain", nuance: "努力して手に入れる（フォーマル）" },
    { word: "acquire", nuance: "獲得する（フォーマル）" },
    { word: "receive", nuance: "受け取る" },
  ],
  make: [
    { word: "create", nuance: "新たに作り出す" },
    { word: "produce", nuance: "生産・生成する" },
    { word: "generate", nuance: "（結果などを）生み出す" },
  ],
  very: [
    { word: "extremely", nuance: "極めて（強調）" },
    { word: "remarkably", nuance: "著しく" },
    { word: "considerably", nuance: "かなり" },
  ],
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
  problem: [
    { word: "issue", nuance: "議論すべき問題" },
    { word: "challenge", nuance: "取り組むべき課題" },
    { word: "obstacle", nuance: "障害となるもの" },
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
  many: [
    { word: "numerous", nuance: "数多くの（フォーマル）" },
    { word: "considerable", nuance: "かなりの数の" },
    { word: "plentiful", nuance: "豊富にある" },
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
  thing: [
    { word: "aspect", nuance: "物事の一側面" },
    { word: "factor", nuance: "要因" },
    { word: "element", nuance: "構成要素" },
  ],
};

export const genericSynonymMap: Map<string, Suggestion[]> = new Map(
  Object.entries(genericSynonyms),
);
