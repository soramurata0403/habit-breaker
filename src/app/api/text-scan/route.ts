import { MAX_TEXT_LENGTH as MAX_ANALYZE_LENGTH } from "@/lib/config";
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
};
type SuccessPayload = { issues: IssueEntry[] };

const SYSTEM_PROMPT = `あなたは英文エッセイの校正者です。
与えられた英文全体を読み、「スペル自体は正しい実在の英単語だが、文脈上は
明らかに誤り（別の語の誤字、または文法上の誤り）である」箇所だけを特定してください。

例: "I've leaned this in BYU" の "leaned" は "learned" の誤字。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "issues": [
    {
      "word": "誤りの中心となる単語（原文に登場する綴りのまま）",
      "phrase": "置き換える対象の原文の範囲。1語なら word と同じ文字列。動詞句なら句全体",
      "correction": "phrase を置き換える正しい表現",
      "explanation": "なぜ誤りなのかの簡潔な日本語説明（1〜2文）"
    }
  ]
}

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
be動詞や助動詞と組み合わさった表現を直す場合、単語1語だけを置き換えると
文法が壊れる。**動詞句全体を1つの修正単位**として "phrase" に入れること。
- 例: "I am believing that..." は "believing" だけを "believe" にすると
  "am believe" という新たな文法違反になる。
  正しくは phrase: "am believing", correction: "believe" とすること
- 同様に進行形・完了形・受動態・助動詞を含む誤りは、必ず句全体を phrase にすること
- "phrase" は必ず原文にそのまま現れる連続した文字列であること
  （前後の語を勝手に変えたり、原文にない語を含めないこと）
- "word" は "phrase" に含まれる語のうち、誤りの中心となる1語にすること

## その他の条件
- 単なる文体の癖・口語的な表現・語彙選択の稚拙さは対象外にすること
  （それらは別の機能で扱うため、ここでは「明らかな誤り」のみを対象にすること）
- 存在しない単語（単純なスペルミス）は対象外にすること（別のロジックで検出済みのため）
- 確信が持てない場合は含めないこと（誤検知を避けるため保守的に判断すること）
- 誤りが1つも見つからない場合は "issues": [] とすること`;

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
    );
  });
}

export async function POST(request: Request) {
  const limit = checkRateLimit(request);
  if (!limit.ok) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストボディが不正です。" }, { status: 400 });
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
      console.error("OpenAI API error (text-scan):", openaiResponse.status, errorText);
      return Response.json({ error: "文脈チェックに失敗しました。" }, { status: 502 });
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("OpenAI API returned an unexpected shape (text-scan):", data);
      return Response.json({ error: "AIの応答が不正な形式でした。" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse OpenAI JSON content (text-scan):", content);
      return Response.json(
        { error: "AIの応答をJSONとして解釈できませんでした。" },
        { status: 502 },
      );
    }

    if (!isSuccessPayload(parsed)) {
      console.error("OpenAI JSON content failed shape validation (text-scan):", parsed);
      return Response.json(
        { error: "AIの応答が期待した形式ではありませんでした。" },
        { status: 502 },
      );
    }

    // "phrase" は置換範囲の特定に使うため、原文にそのまま現れるものだけを通す。
    // また "word" が "phrase" に含まれていないと、ハイライト位置と置換範囲が
    // 対応しなくなるため除外する。
    const issues = parsed.issues.filter((issue) => {
      const phrase = issue.phrase.trim();
      return (
        text.includes(phrase) &&
        phrase.toLowerCase().includes(issue.word.trim().toLowerCase()) &&
        issue.correction.trim() !== phrase
      );
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
