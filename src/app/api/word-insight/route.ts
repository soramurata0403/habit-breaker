export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONTEXT_LENGTH = 500;

type Candidate = { word: string; nuance: string };
type SuccessPayload = { explanation: string; candidates: Candidate[] };

const SYSTEM_PROMPT = `あなたはTOEFL / IELTSのアカデミックライティングを指導する英語講師です。
与えられた「対象単語」と、それが使われている「文脈」をもとに、より洗練されたアカデミックな同義語を3つ提案してください。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "explanation": "対象単語の文脈における使い方についての簡潔な日本語解説（1〜2文）",
  "candidates": [
    { "word": "言い換え単語1", "nuance": "ニュアンスの日本語説明（20文字程度）" },
    { "word": "言い換え単語2", "nuance": "ニュアンスの日本語説明（20文字程度）" },
    { "word": "言い換え単語3", "nuance": "ニュアンスの日本語説明（20文字程度）" }
  ]
}

条件:
- candidates は与えられた文脈に自然に当てはまる語のみを3つ提案すること
- 口語的すぎる表現は避け、TOEFL/IELTSのエッセイで違和感のないフォーマルな語彙を選ぶこと
- explanation と nuance は日本語で書くこと
- word には元の単語と同じ品詞・時制・活用形に近い形の英単語を1語（またはごく短い句）で入れること`;

function buildUserPrompt(word: string, contextSentence: string) {
  return `対象単語: "${word}"\n文脈: "${contextSentence}"\n\nこの文脈における "${word}" の、よりアカデミックな言い換え候補を3つ提案してください。`;
}

function isSuccessPayload(value: unknown): value is SuccessPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.explanation !== "string" || obj.explanation.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(obj.candidates) || obj.candidates.length === 0) return false;
  return obj.candidates.every((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const c = candidate as Record<string, unknown>;
    return (
      typeof c.word === "string" &&
      c.word.trim().length > 0 &&
      typeof c.nuance === "string" &&
      c.nuance.trim().length > 0
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

  const { word, contextSentence } = (body ?? {}) as {
    word?: unknown;
    contextSentence?: unknown;
  };

  if (typeof word !== "string" || word.trim().length === 0) {
    return Response.json({ error: "word は必須です。" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY が設定されていません。" },
      { status: 503 },
    );
  }

  const safeContext =
    typeof contextSentence === "string" && contextSentence.trim().length > 0
      ? contextSentence.trim().slice(0, MAX_CONTEXT_LENGTH)
      : word;

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
        temperature: 0.4,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(word, safeContext) },
        ],
      }),
      signal: controller.signal,
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(() => "");
      console.error("OpenAI API error:", openaiResponse.status, errorText);
      return Response.json(
        { error: "AIによる言い換え候補の生成に失敗しました。" },
        { status: 502 },
      );
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("OpenAI API returned an unexpected shape:", data);
      return Response.json({ error: "AIの応答が不正な形式でした。" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse OpenAI JSON content:", content);
      return Response.json(
        { error: "AIの応答をJSONとして解釈できませんでした。" },
        { status: 502 },
      );
    }

    if (!isSuccessPayload(parsed)) {
      console.error("OpenAI JSON content failed shape validation:", parsed);
      return Response.json(
        { error: "AIの応答が期待した形式ではありませんでした。" },
        { status: 502 },
      );
    }

    return Response.json(
      {
        explanation: parsed.explanation,
        candidates: parsed.candidates.slice(0, 3),
      },
      { status: 200 },
    );
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.error("word-insight API route error:", error);
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
