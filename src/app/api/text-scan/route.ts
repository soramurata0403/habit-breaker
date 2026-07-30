export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TEXT_LENGTH = 4000;

type TypoEntry = { word: string; suggestedSpelling: string; explanation: string };
type SuccessPayload = { typos: TypoEntry[] };

const SYSTEM_PROMPT = `あなたは英文エッセイの校正者です。
与えられた英文全体を読み、「スペル自体は正しい実在の英単語だが、文脈上は
明らかに別の単語の誤字（タイポ）だと考えられる」語だけを特定してください。

例: "I've leaned this in BYU" の "leaned" は "learned" の誤字。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "typos": [
    {
      "word": "文中に実際に登場する単語（原文の綴りのまま）",
      "suggestedSpelling": "正しいと思われる単語",
      "explanation": "誤字だと判断した理由の簡潔な日本語説明（1文）"
    }
  ]
}

条件:
- 単なる文体の癖・口語的な表現・語彙選択の稚拙さは対象外にすること
  （それらは別の機能で扱うため、ここでは「明らかな誤字」のみを対象にすること）
- 存在しない単語（スペルミス）は対象外にすること（別のロジックで検出済みのため）。
  実在する単語の中から、文脈的に誤っているものだけを見つけること
- 確信が持てない場合は含めないこと（誤検知を避けるため保守的に判断すること）
- 誤字が1つも見つからない場合は "typos": [] とすること`;

function isSuccessPayload(value: unknown): value is SuccessPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.typos)) return false;
  return obj.typos.every((item) => {
    if (!item || typeof item !== "object") return false;
    const t = item as Record<string, unknown>;
    return (
      typeof t.word === "string" &&
      t.word.trim().length > 0 &&
      typeof t.suggestedSpelling === "string" &&
      t.suggestedSpelling.trim().length > 0 &&
      typeof t.explanation === "string" &&
      t.explanation.trim().length > 0
    );
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストボディが不正です。" }, { status: 400 });
  }

  const { text } = (body ?? {}) as { text?: unknown };

  if (typeof text !== "string" || text.trim().length === 0) {
    return Response.json({ typos: [] }, { status: 200 });
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

    return Response.json({ typos: parsed.typos }, { status: 200 });
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
