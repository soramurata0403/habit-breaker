export type Suggestion = {
  word: string;
  nuance: string;
};

export type HabitRule = {
  word: string;
  insight: string;
  suggestions: Suggestion[];
};

export const habitRules: HabitRule[] = [
  {
    word: "bad",
    insight:
      "エッセイ（書き言葉）においてbadはB2レベルになっても残る典型的な脱却ポイントです（ネイティブの約5倍多用）。具体的で高度な評価形容詞へ言い換えましょう。",
    suggestions: [
      { word: "harmful", nuance: "健康・環境などに有害な" },
      { word: "detrimental", nuance: "結果や影響が悪影響を及ぼす" },
      { word: "ineffective", nuance: "政策や対策が不十分・効果がない" },
    ],
  },
  {
    word: "think",
    insight:
      "I thinkの連発はエッセイでは語彙力不足と判断されやすい傾向があります（ネイティブの約2.9倍多用）。確信度や論理に応じた動詞を使い分けましょう。",
    suggestions: [
      { word: "believe", nuance: "確信を持って意見を述べる" },
      { word: "argue", nuance: "根拠を挙げて主張する" },
      { word: "contend", nuance: "議論を立てて強く主張する" },
    ],
  },
  {
    word: "we",
    insight:
      "スピーチやエッセイで主語をweにするのは日本人特有の集団化の癖です（ネイティブの4〜8倍）。より具体的・客観的な名詞を使いましょう。",
    suggestions: [
      { word: "students", nuance: "学生一般を指す" },
      { word: "individuals", nuance: "個々の人々・個人" },
      { word: "society", nuance: "社会全体を指す" },
    ],
  },
  {
    word: "so",
    insight:
      "文頭や文中で接続詞soを連発するのは口語の癖です（ネイティブの2.5倍）。書き言葉用の論理接続詞に言い換えましょう。",
    suggestions: [
      { word: "therefore", nuance: "それゆえに（硬い論理）" },
      { word: "as a result", nuance: "結果として" },
      { word: "consequently", nuance: "結果に伴って" },
    ],
  },
];

export const habitRuleMap: Map<string, HabitRule> = new Map(
  habitRules.map((rule) => [rule.word.toLowerCase(), rule]),
);

export const SAMPLE_TEXT =
  "I think this policy is bad because we cannot save money. So we should change it.";
