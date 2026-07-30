export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_OCCURRENCES = 24;
const MAX_SENTENCE_LENGTH = 300;

type Occurrence = { id: number; word: string; sentence: string };
type ResultEntry = { id: number; isVague: boolean };
type SuccessPayload = { results: ResultEntry[] };

const SYSTEM_PROMPT = `あなたは英文エッセイにおける代名詞 we / us / our の使い方を判定する校正者です。

入力は { "occurrences": [{ "id": number, "word": "we"|"us"|"our", "sentence": string }, ...] }
という配列で、それぞれが文章中の we/us/our の1つの出現箇所と、それを含む文（前後の文脈）を表します。

各itemについて、その we/us/our が次のどちらの使われ方かを判定してください:

1. 具体的な人物を指す代名詞として適切に使われている
   （例: "my friend and I", "Lehi and I", "my colleague", "my family" など、
   文中に具体的な人物・関係性が明示されており、その人たちを指している場合）
   → isVague: false

2. 「人々全般」「社会」「人類」を指す、曖昧で抽象的な主語・目的語・所有格として
   使われている（例: "We often think that technology..." のような、
   TOEFL/IELTSのアカデミックエッセイにありがちな一般論の書き出し）
   → isVague: true

Check if 'we'/'us'/'our' has a specific antecedent (e.g., "my friend and I").
If it refers to specific people, do NOT mark it as vague (isVague: false).
Only mark it as vague (isVague: true) when it is used as a vague, general
pronoun for people/society/humanity in an academic-essay context.

確信が持てない場合は isVague: false としてください（誤検知を避けるため）。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "results": [
    { "id": 入力と同じid（数値）, "isVague": true または false }
  ]
}

入力された occurrences の全item分について、対応するidで1つずつ結果を返してください。`;

function isSuccessPayload(value: unknown): value is SuccessPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.results)) return false;
  return obj.results.every((item) => {
    if (!item || typeof item !== "object") return false;
    const r = item as Record<string, unknown>;
    return typeof r.id === "number" && typeof r.isVague === "boolean";
  });
}

function isValidOccurrence(value: unknown): value is Occurrence {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "number" &&
    typeof o.word === "string" &&
    o.word.trim().length > 0 &&
    typeof o.sentence === "string"
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストボディが不正です。" }, { status: 400 });
  }

  const { occurrences } = (body ?? {}) as { occurrences?: unknown };

  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    return Response.json({ results: [] }, { status: 200 });
  }

  const safeOccurrences = occurrences
    .filter(isValidOccurrence)
    .slice(0, MAX_OCCURRENCES)
    .map((o) => ({
      id: o.id,
      word: o.word,
      sentence: o.sentence.trim().slice(0, MAX_SENTENCE_LENGTH),
    }));

  if (safeOccurrences.length === 0) {
    return Response.json({ results: [] }, { status: 200 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY が設定されていません。" },
      { status: 503 },
    );
  }

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
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({ occurrences: safeOccurrences }),
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text().catch(() => "");
      console.error("OpenAI API error (pronoun-context):", openaiResponse.status, errorText);
      return Response.json({ error: "文脈チェックに失敗しました。" }, { status: 502 });
    }

    const data = await openaiResponse.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      console.error("OpenAI API returned an unexpected shape (pronoun-context):", data);
      return Response.json({ error: "AIの応答が不正な形式でした。" }, { status: 502 });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("Failed to parse OpenAI JSON content (pronoun-context):", content);
      return Response.json(
        { error: "AIの応答をJSONとして解釈できませんでした。" },
        { status: 502 },
      );
    }

    if (!isSuccessPayload(parsed)) {
      console.error("OpenAI JSON content failed shape validation (pronoun-context):", parsed);
      return Response.json(
        { error: "AIの応答が期待した形式ではありませんでした。" },
        { status: 502 },
      );
    }

    return Response.json({ results: parsed.results }, { status: 200 });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    console.error("pronoun-context API route error:", error);
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
