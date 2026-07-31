import { MAX_TEXT_LENGTH as MAX_ANALYZE_LENGTH } from "@/lib/config";
import { isSafeReplacementScope } from "@/lib/phrase-scope";
import { checkRateLimit, rateLimitResponse } from "@/lib/server-rate-limit";

export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_LENGTH = 4000;

type IssueEntry = {
  word: string;
  phrase: string;
  correction: string;
  explanation: string;
  /** error = 文法・表記の誤り（赤）／ style = 口語的でアカデミックでない表現（黄） */
  severity: "error" | "style";
};
type SuccessPayload = { issues: IssueEntry[] };

const SYSTEM_PROMPT = `あなたはTOEFL / IELTS向けの英文エッセイを添削する校正者です。
与えられた英文全体を読み、次の2種類の指摘を洗い出してください。

- severity "error"（赤）: 文法・時制・表記の明らかな誤り
- severity "style"（黄）: 文法的には正しいが、アカデミックライティングとしては
  口語的・初級的すぎる表現

日常会話のようなカジュアルな文章が入力されることも多いので、
「間違いではないが試験の答案としては不適切」な表現も必ず拾ってください。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "issues": [
    {
      "word": "指摘の中心となる語（原文に登場する綴りのまま。記号の場合は記号そのもの）",
      "phrase": "置き換える対象の原文の範囲。1語なら word と同じ文字列",
      "correction": "phrase を置き換える表現",
      "explanation": "なぜ問題なのかの簡潔な日本語説明（1〜2文）",
      "severity": "error" または "style"
    }
  ]
}

## 必ず検出する対象

### A. 時制の不一致（severity: "error"）
同じ文・同じ文脈が過去の出来事を述べているのに、一部だけ現在形が混ざっている場合は
必ず指摘すること。過去形で揃える修正案を出すこと。
- 例: "I woke up at seven and go to school." の "go" は過去形の文脈に混ざった現在形。
  word="go", phrase="go", correction="went", severity="error"
- 周囲の動詞（woke, ate, was, went など）が過去形かどうかを手がかりに判断すること
- 逆に、一般論・習慣を述べる現在形が正しく使われている箇所は指摘しないこと

### B. アカデミックでない記号（severity: "error"）
TOEFL / IELTS の答案では使えない記号は書式違反として指摘すること。
- 感嘆符（"!" や "!!"）→ correction は "." にすること
- 絵文字（😀 など）→ correction は "." にするか、直前の句読点に合わせること
- 意味のない省略記号（"..."）→ correction は "." にすること
- word と phrase にはその記号そのもの（例: "!!"）を入れること

### C. 文構造の破壊・不完全文（severity: "error"）
ピリオドの打ち間違いによる文の分断は、必ず指摘すること。
- **ピリオドの直後に小文字の等位接続詞（and / but / so / or / because など）**が
  続いている場合、その接続詞以降が主語や動詞を欠いた断片（Sentence Fragment）に
  なっている。必ず指摘すること。
  例: "I consumed tacos. and went to school"
  → phrase=". and", correction=", and"（コンマ接続に直す）
  もしくは phrase="and", correction="And I"（ピリオドを保ったまま主語を補う）
  のどちらか、文脈上自然な方を選ぶこと
- 接続詞以外でも、ピリオドの後に主語・動詞が揃っていない断片が続く場合は指摘すること

### D. 大文字・小文字の不整合（severity: "error"）
文頭（文章の先頭、またはピリオド・感嘆符・疑問符の直後）が小文字で始まっている
場合はエラーとして指摘すること。
- phrase にはその小文字の語、correction には先頭を大文字にした形を入れること
  例: phrase="and", correction="And"
- ただし "a.m." / "p.m." / "e.g." / "i.e." / 小数点・略語のピリオドは
  文末ではないので、その後が小文字でも指摘しないこと

### E. 語の重複・二重入力（severity: "error"）
前置詞・冠詞・助動詞などの機能語が重複している場合は必ず指摘すること。
- 例: "at around at 9" → phrase="at around at", correction="at around"
- 例: "in in the morning" → phrase="in in", correction="in"
- 例: "the the" / "to to" / "is is" なども同様
- **correction は phrase から余分な語を取り除いただけの形にすること**
  （新しい語を持ち込まず、残す語は元のまま）

### F. 不自然なコロケーション（severity: "error"）
動詞と名詞の組み合わせが英語として成立していない場合は、**style ではなく error**
として指摘すること（言い換えの好みではなく誤りだから）。
- 例: "take Baptism" は英語として不自然 → "get baptized" / "be baptized"
- phrase には動詞から始まるコロケーション全体（最大3語）、word にはその**先頭の動詞**
  を入れること。例: word="take", phrase="take Baptism", correction="get baptized"
- **correction は、その句が置かれている節にそのまま入れて成立する形にすること。**
  前後を読み、主語・接続詞・助動詞に合う活用を選ぶこと:
  - "if I take Baptism" → "if I ___" に入る形なので "get baptized"
    （"be baptized" は "if I be baptized" となり誤り）
  - "I will take Baptism" → 助動詞の後なので "be baptized" でよい
  - "I want to take Baptism" → to の後なので "be baptized" でよい

### G. 可算名詞の冠詞抜け（severity: "error"）
単数の可算名詞が冠詞なしで動詞の目的語になっている場合は指摘すること。
- 例: "I took lesson" → "a lesson"（または "lessons"）
- **phrase はその名詞1語だけ**にし、correction に冠詞を付けた形を入れること
  例: word="lesson", phrase="lesson", correction="a lesson"
- 固有名詞・不可算名詞（information, advice, water など）は対象外

### H. "how to" の直後の品詞（severity: "error"）
"how to" の直後は動詞の原形でなければならない。名詞が来ている場合は指摘すること。
- 例: "how to baptism" → "how to be baptized"
- **phrase はその名詞1語だけ**にし、correction に動詞句を入れること
  例: word="baptism", phrase="baptism", correction="be baptized"
- 名詞のまま残したい場合は "about baptism" / "regarding baptism" のように
  前置詞句へ直す案でもよい（その場合も phrase は最小限にすること）

### I. 口語的・初級的な表現（severity: "style"）
文法は正しくても、日常会話的すぎてアカデミックな答案にふさわしくない語句を指摘すること。
- 例: "at around" → "at approximately"
- 例: "ate" → "consumed"
- 例: "got" → "obtained" / "received"、"a lot of" → "numerous"、
  "kids" → "children"、"stuff" → "materials"、"really" → "considerably"
- word には中心となる語、phrase には置き換える範囲（"at around" のような2語の
  かたまりならその範囲）を入れること
- 意味が変わってしまう言い換えは提案しないこと

## 修正案を作る際に必ず守る3原則

### 1. 品詞と文法機能の一致
対象の語が文中で果たしている文法機能（何を修飾しているか）を判定し、
**まったく同じ品詞・文法機能を持つ形**を修正案にすること。
- 動詞を修飾している位置（副詞的役割）なら、修正案も副詞にすること
  （例: "I answered wrong" → "incorrectly" / "wrongly"。形容詞や反対語にはしない）
- 名詞を修飾している位置なら形容詞、主語・目的語の位置なら名詞にすること
- 元の語の時制・数・活用も、文法的に正しい範囲で揃えること

### 2. 文脈優先のセマンティック検証
単語単体の辞書的意味や機械的な対義語を当てはめてはいけない。
**置き換えた後の文全体を読み直し、意味が通るか**を必ず検証すること。
- 「誤りを正す」ニュアンスが必要な場面で、単に反対の意味の語へ置換しないこと
  （例: "wrong" を機械的に "right" にするのは誤り。文脈が「間違って答えた」なら
  正しい修正は品詞を揃えた "incorrectly" であって "correctly" ではない）
- 置換後の文が不自然・意味不明になる場合は、その候補を捨てること

### 3. 修正スコープの最適化（句の境界認識）
"phrase" は**必要最小限の範囲**にすること。原則は「対象語1語」で、
be動詞・助動詞と一体で直さないと文法が壊れる場合に限って句に広げる。

- 既定: phrase は word と同じ1語にすること
- 例外: "I am believing that..." は "believing" だけを "believe" にすると
  "am believe" という新たな文法違反になる。
  この場合のみ phrase: "am believing", correction: "believe" とすること

**phrase に含めてよいのは、対象語そのものと、それに直接くっついた
be動詞・助動詞・否定語（am / is / are / was / were / be / been / being /
have / has / had / do / does / did / will / would / can / could / should /
must / not / to など）だけ。**

- 他の動詞・名詞・目的語を phrase に含めては絶対にいけない
  誤り例: word="wrong", phrase="affect everyone wrong", correction="incorrectly"
  → これは "affect everyone" まで置換範囲に入ってしまい、適用すると
    "it will affect everyone wrong" が "it will incorrectly" になって
    文が壊れる。正しくは phrase="wrong", correction="adversely" のように
    **対象語だけ**を範囲にすること
- "phrase" は必ず原文にそのまま現れる連続した文字列であること
  （前後の語を勝手に変えたり、原文にない語を含めないこと）
- "word" は "phrase" に含まれる語のうち、誤りの中心となる1語にすること

### 4. 副詞の選定は「文が伝えたい意味」に合わせる
動詞を修飾する副詞を直す場合、動詞との相性と文意を必ず確認すること。
- "affect"（影響を与える）を修飾する副詞は、多くの場合
  **adversely / negatively（悪影響を与える）**が自然。
  例: "it will affect everyone wrong" → "wrong" を "adversely" または
  "negatively" にする（"incorrectly" は「やり方が不正確」という意味になり、
  「悪影響が及ぶ」という文意に合わないので選ばないこと）
- 同様に、動詞ごとに共起しやすい副詞（significantly, severely, directly など）
  の中から、文意に最も合うものを選ぶこと

## severity ごとの phrase の作り方（重要）
- severity "error" の場合: 上記のとおり **対象語1語**が原則。
  be動詞・助動詞と一体で直す場合のみ句に広げる。
- severity "style" の場合: "at around" のような**決まった言い回しのかたまり**なら
  そのまとまりを phrase にしてよい（最大3語）。ただし correction の語数も
  同程度にすること（"at around" → "at approximately" のように1対1で置き換わる形）。
  周囲の内容語を巻き込んで短い語に潰すような指定は絶対にしないこと。
- severity "error" で記号を指摘する場合: word と phrase はその記号だけにすること。
- 語の重複を消す場合（E）や、ピリオドをコンマに変える場合（C）は、
  phrase に必要な範囲（最大6語）を取ってよい。ただし **correction は phrase から
  語を取り除いた形か、語はそのままで記号だけを変えた形**にすること。
  phrase の語を別の語に置き換えて短く潰すのは禁止。
- word には phrase に含まれる語のうち、指摘の中心となる1語を入れること
  （記号だけを直す場合を除き、word は必ずアルファベットの語にすること）。
- コロケーションの入れ替え（F）で phrase を2語以上にする場合、
  **word は必ず phrase の先頭の語**にすること。
  （先頭以外を word にすると、その手前の語まで置換範囲に入り消えてしまう）
- 冠詞の補い（G）や "how to"（H）のように語を差し替える場合は、
  phrase を**その1語だけ**に絞り、前後の語を含めないこと。

## 置換後の文を必ず読み返すこと
correction を phrase の位置に入れた文を組み立て直し、文法として成立するか確認すること。
- 主語の直後に原形の be を置かないこと（"if I be baptized" は誤り）
- 助動詞・to がある場合のみ原形を使うこと
- 成立しない場合は、その節に合う活用へ直してから出力すること

## その他の条件
- 存在しない単語（単純なスペルミス）は対象外にすること（別のロジックで検出済みのため）
- 確信が持てない場合は含めないこと（誤検知を避けるため保守的に判断すること）
- 同じ箇所を error と style の両方で重複して指摘しないこと
- 指摘が1つも無い場合は "issues": [] とすること`;

function isSuccessPayload(value: unknown): value is SuccessPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.issues)) return false;
  return obj.issues.every((item) => {
    if (!item || typeof item !== "object") return false;
    const t = item as Record<string, unknown>;
    return (
      typeof t.word === "string" &&
      t.word.trim().length > 0 &&
      typeof t.phrase === "string" &&
      t.phrase.trim().length > 0 &&
      typeof t.correction === "string" &&
      t.correction.trim().length > 0 &&
      typeof t.explanation === "string" &&
      t.explanation.trim().length > 0
      // severity は欠けていても弾かず、後段で "error" に寄せる
      // （必須にするとフィールド1つの欠落で指摘ごと失われてしまうため）。
    );
  });
}

/** severity が欠けている・不正な場合は誤り（赤）として扱う。 */
function normalizeSeverity(value: unknown): "error" | "style" {
  return value === "style" ? "style" : "error";
}

export async function POST(request: Request) {
  const limit = checkRateLimit(request);
  if (!limit.ok) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "リクエストボディが不正です。" },
      { status: 400 },
    );
  }

  const { text } = (body ?? {}) as { text?: unknown };

  if (typeof text !== "string" || text.trim().length === 0) {
    return Response.json({ issues: [] }, { status: 200 });
  }

  if (text.length > MAX_ANALYZE_LENGTH) {
    return Response.json(
      { error: `解析できるのは${MAX_ANALYZE_LENGTH}文字までです。` },
      { status: 413 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY が設定されていません。" },
      { status: 503 },
    );
  }

  const safeText = text.trim().slice(0, MAX_TEXT_LENGTH);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const openaiResponse = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: safeText },
        ],
      }),
      signal: controller.signal,
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(() => "");
      console.error(
        "OpenAI API error (text-scan):",
        openaiResponse.status,
        errorText,
      );
      return Response.json(
        { error: "文脈チェックに失敗しました。" },
        { status: 502 },
      );
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error(
        "OpenAI API returned an unexpected shape (text-scan):",
        data,
      );
      return Response.json(
        { error: "AIの応答が不正な形式でした。" },
        { status: 502 },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error(
        "Failed to parse OpenAI JSON content (text-scan):",
        content,
      );
      return Response.json(
        { error: "AIの応答をJSONとして解釈できませんでした。" },
        { status: 502 },
      );
    }

    if (!isSuccessPayload(parsed)) {
      console.error(
        "OpenAI JSON content failed shape validation (text-scan):",
        parsed,
      );
      return Response.json(
        { error: "AIの応答が期待した形式ではありませんでした。" },
        { status: 502 },
      );
    }

    // "phrase" は置換範囲の特定に使うため、原文にそのまま現れるものだけを通す。
    // また "word" が "phrase" に含まれていないと、ハイライト位置と置換範囲が
    // 対応しなくなるため除外する。
    const issues = parsed.issues
      .map((issue) => ({
        ...issue,
        severity: normalizeSeverity(issue.severity),
      }))
      .filter((issue) => {
        const phrase = issue.phrase.trim();
        const word = issue.word.trim();

        // 原文にそのまま現れない句は置換範囲を特定できないため除外する。
        if (!text.includes(phrase)) return false;
        if (issue.correction.trim() === phrase) return false;

        // 置換範囲が広すぎるものは除外する。対象語と無関係な語（他の動詞・
        // 目的語など）を巻き込んだ句を許すと、適用時にそれらが消えてしまう。
        //   例: word="wrong", phrase="affect everyone wrong"
        //       → "affect everyone" まで削除されてしまうので受け付けない
        if (
          !isSafeReplacementScope({
            word,
            phrase,
            correction: issue.correction,
            severity: issue.severity,
          })
        ) {
          return false;
        }

        return true;
      });

    return Response.json({ issues }, { status: 200 });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.error("text-scan API route error:", error);
    return Response.json(
      {
        error: isAbort
          ? "AIの応答がタイムアウトしました。"
          : "予期しないエラーが発生しました。",
      },
      { status: isAbort ? 504 : 500 },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
