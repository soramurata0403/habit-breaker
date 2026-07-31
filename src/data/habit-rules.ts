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
      "「人々全般」や「社会」を指す抽象的な主語としてweを使うのは日本人特有の集団化の癖です（ネイティブの4〜8倍）。より具体的・客観的な主語を使いましょう。",
    suggestions: [
      { word: "students", nuance: "学生一般を指す" },
      { word: "individuals", nuance: "個々の人々・個人" },
      { word: "society", nuance: "社会全体を指す" },
    ],
  },
  {
    word: "us",
    insight:
      "usも同様に、具体的な対象を指さず「人々全般」を意味する曖昧な目的語として使われがちです。より具体的な語に言い換えましょう。",
    suggestions: [
      { word: "individuals", nuance: "個々の人々・個人" },
      { word: "people", nuance: "人々" },
      { word: "society", nuance: "社会全体（目的語として）" },
    ],
  },
  {
    word: "our",
    insight:
      "ourも同様に、具体的な対象を指さない曖昧な所有格として使われがちです。より具体的な語に言い換えましょう。",
    suggestions: [
      { word: "people's", nuance: "人々の（所有格）" },
      { word: "society's", nuance: "社会の（所有格）" },
      { word: "individuals'", nuance: "個人の（所有格）" },
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
  {
    word: "important",
    insight:
      "importantは便利な万能語ですが、具体性に欠けるため日本人学習者に多用されがちです。重要性の種類に応じてより精密な語に言い換えましょう。",
    suggestions: [
      { word: "crucial", nuance: "決定的に重要な" },
      { word: "essential", nuance: "不可欠な" },
      { word: "significant", nuance: "意義が大きい" },
    ],
  },
  {
    word: "good",
    insight:
      "goodは日本語の「良い」をそのまま当てはめがちな典型的な万能形容詞です。ネイティブは文脈に応じてより具体的な評価語を使います。",
    suggestions: [
      { word: "beneficial", nuance: "利益や効果の観点で良い" },
      { word: "favorable", nuance: "状況や条件が好ましい" },
      { word: "excellent", nuance: "非常に優れている" },
    ],
  },
  {
    word: "nice",
    insight:
      "niceは口語的で漠然とした印象を与えるため、アカデミックライティングでは避けられがちです。具体的な性質を表す語に言い換えましょう。",
    suggestions: [
      { word: "pleasant", nuance: "心地よい" },
      { word: "agreeable", nuance: "好ましい・同意しやすい" },
      { word: "delightful", nuance: "非常に喜ばしい" },
    ],
  },
  {
    word: "big",
    insight:
      "bigは規模を表す基本語ですが、フォーマルな文章では抽象的すぎると判断されがちです。程度に応じた語へ言い換えましょう。",
    suggestions: [
      { word: "substantial", nuance: "量や規模が相当な" },
      { word: "considerable", nuance: "無視できないほど大きい" },
      { word: "significant", nuance: "重要な意味を持つほど大きい" },
    ],
  },
  {
    word: "small",
    insight:
      "smallも同様に規模・程度を漠然と表す基本語です。より精密な語に言い換えると説得力が増します。",
    suggestions: [
      { word: "minor", nuance: "重要度や規模が小さい" },
      { word: "negligible", nuance: "無視できるほど小さい" },
      { word: "modest", nuance: "控えめな規模の" },
    ],
  },
  {
    word: "useful",
    insight:
      "usefulは便利ですが漠然とした語で、具体的にどう役立つのかを示す語の方が説得力が増します。",
    suggestions: [
      { word: "beneficial", nuance: "利益をもたらす" },
      { word: "practical", nuance: "実用的な" },
      { word: "valuable", nuance: "価値のある" },
    ],
  },
  {
    word: "convenient",
    insight:
      "convenientは日常会話的な響きが強く、エッセイではより硬い語彙への言い換えが好まれます。",
    suggestions: [
      { word: "practical", nuance: "実用面で都合が良い" },
      { word: "accessible", nuance: "利用しやすい" },
      { word: "efficient", nuance: "効率的な" },
    ],
  },
  {
    word: "many",
    insight:
      "manyは基本的な数量表現ですが、フォーマルな文章ではより具体的・強調的な語が好まれます。",
    suggestions: [
      { word: "numerous", nuance: "数多くの（フォーマル）" },
      { word: "considerable", nuance: "かなりの数の" },
      { word: "plentiful", nuance: "豊富にある" },
    ],
  },
  {
    word: "a lot of",
    insight:
      "a lot ofは口語的な量表現の典型で、エッセイではより硬い語に置き換えるべきとされます。",
    suggestions: [
      { word: "numerous", nuance: "数多くの" },
      { word: "a great deal of", nuance: "かなりの量の" },
      { word: "substantial", nuance: "相当な量の" },
    ],
  },
  {
    word: "very",
    insight:
      "veryは強調のために多用されがちですが、単調な印象を与えます。それ自体で強い意味を持つ語に言い換えましょう。",
    suggestions: [
      { word: "extremely", nuance: "極めて（強調）" },
      { word: "remarkably", nuance: "著しく" },
      { word: "particularly", nuance: "特に" },
    ],
  },
  {
    word: "thing",
    insight:
      "thingは対象を曖昧にしてしまう典型的な万能名詞です。具体的に何を指しているかを表す語に言い換えましょう。",
    suggestions: [
      { word: "aspect", nuance: "物事の一側面" },
      { word: "factor", nuance: "要因" },
      { word: "element", nuance: "構成要素" },
    ],
  },
  {
    word: "problem",
    insight:
      "problemは頻出する基本語ですが、問題の性質に応じてより的確な語を選ぶと説得力が増します。",
    suggestions: [
      { word: "issue", nuance: "議論すべき問題" },
      { word: "challenge", nuance: "取り組むべき課題" },
      { word: "obstacle", nuance: "障害となるもの" },
    ],
  },
  {
    word: "make",
    insight:
      "makeは汎用性が高い分、具体性に欠ける動詞です。何を作る・生じさせるのかに応じて動詞を使い分けましょう。",
    suggestions: [
      { word: "create", nuance: "新たに作り出す" },
      { word: "produce", nuance: "生産・生成する" },
      { word: "generate", nuance: "（結果などを）生み出す" },
    ],
  },
  {
    word: "get",
    insight:
      "getは口語で多用される動詞で、フォーマルな文章ではより正確な動詞への言い換えが好まれます。",
    suggestions: [
      { word: "obtain", nuance: "努力して手に入れる（フォーマル）" },
      { word: "acquire", nuance: "獲得する（フォーマル）" },
      { word: "receive", nuance: "受け取る" },
    ],
  },
  {
    word: "have",
    insight:
      "haveは所有・状態を表す基本動詞ですが、多用すると単調になります。文脈に応じてより具体的な動詞に言い換えましょう。",
    suggestions: [
      { word: "possess", nuance: "所有する（フォーマル）" },
      { word: "experience", nuance: "経験する" },
      { word: "hold", nuance: "保持する" },
    ],
  },
  {
    word: "in my opinion",
    insight:
      "in my opinionは意見を述べる定型表現ですが、多用するとエッセイの客観性・論理性を弱めてしまいます。",
    suggestions: [
      { word: "arguably", nuance: "議論の余地はあるが（硬い表現）" },
      { word: "it could be argued that", nuance: "〜と主張できる" },
      { word: "from my perspective", nuance: "私の視点からは" },
    ],
  },
  {
    word: "i believe",
    insight:
      "I believeも主観的な意見表明の定型句で、多用するとエッセイの客観性・論理性を弱めてしまいます。",
    // このルールは "I believe"（主語＋動詞）全体を置換対象にするため、
    // 候補側にも主語を含めておく（動詞だけにすると主語が消えてしまう）。
    suggestions: [
      { word: "I argue", nuance: "根拠を挙げて主張する" },
      { word: "I contend", nuance: "強く主張する" },
      { word: "I maintain", nuance: "一貫して主張する" },
    ],
  },
];

// we/us/our は単語単体では機械的に判定できず、AIによる文脈判定
// （具体的な人物を指しているか、曖昧な一般論の主語かの判定）が
// 必要なため、通常の単語ルールとは別に扱う。
export const contextualPronouns: ReadonlySet<string> = new Set(["we", "us", "our"]);

// 単語1語のルール（トークナイザが単語ごとに参照する）。we/us/our は
// 文脈判定が確定するまでは自動でハイライトしないため除外する。
export const habitRuleMap: Map<string, HabitRule> = new Map(
  habitRules
    .filter((rule) => !rule.word.includes(" ") && !contextualPronouns.has(rule.word))
    .map((rule) => [rule.word.toLowerCase(), rule]),
);

// we/us/our のルール。AIが「曖昧な一般論の主語」と確認した場合にのみ
// トークナイザ側でハイライトへ反映する（src/lib/tokenize.ts 参照）。
export const contextualHabitRuleMap: Map<string, HabitRule> = new Map(
  habitRules
    .filter((rule) => contextualPronouns.has(rule.word))
    .map((rule) => [rule.word.toLowerCase(), rule]),
);

// 複数語からなる定型フレーズのルール（"in my opinion" 等）。
// トークナイザが文章全体からフレーズ単位で検出する際に参照する。
export const phraseHabitRules: HabitRule[] = habitRules.filter((rule) =>
  rule.word.includes(" "),
);

export const SAMPLE_TEXT =
  "I think this policy is bad. I think it is bad because we cannot save money. So we should change it, and we must act now.";
