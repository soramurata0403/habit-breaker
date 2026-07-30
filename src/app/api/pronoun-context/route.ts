import { MAX_TEXT_LENGTH as MAX_ANALYZE_LENGTH } from "@/lib/config";
import { checkRateLimit, rateLimitResponse } from "@/lib/server-rate-limit";

export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_OCCURRENCES = 24;
const MAX_SENTENCE_LENGTH = 300;
const MAX_DOCUMENT_LENGTH = 4000;

type Occurrence = { id: number; word: string; sentence: string };
type ResultEntry = { id: number; isVague: boolean };
type SuccessPayload = { results: ResultEntry[] };

const SYSTEM_PROMPT = `あなたは英文エッセイにおける代名詞 we / us / our の使い方を判定する校正者です。

入力は
{ "document": string, "occurrences": [{ "id": number, "word": "we"|"us"|"our", "sentence": string }, ...] }
という形式で、"document" は文章全体、"occurrences" はその中の we/us/our の各出現箇所と、
それを含む一文（前後の文脈）を表します。

## ステップ1: 文章全体のトーン（ジャンル）を判定する

"document" 全体を読み、次のどちらのタイプかをまず判断してください:

A. 個人的な体験談・エッセイ・志望理由書（Personal Statement）
   一人称（I, my, me）や、具体的な人物・出来事・関係性
   （例: friend, conversed, talked, team, Lehi のような固有名詞や具体的なエピソード）
   が含まれ、著者自身の経験・体験を語っている文章。

B. アカデミックな論説文
   特定の個人の体験ではなく、「社会」「人々」「人類」といった対象について
   一般論・主張を展開している文章。

**"document" がAだと判断した場合、その中に含まれる we/us/our は、
著者自身と、具体的な友人・家族・同僚・チームメイトなどの人々を指していると
考えるのが自然です。この場合、occurrences の isVague はすべて false としてください
（個々の文について詳細な判定を行う必要はありません）。**

"document" がBだと判断した場合のみ、ステップ2に進んでください。

## ステップ2（"document" がBの場合のみ）: 出現箇所ごとの判定

occurrences の各itemについて、その we/us/our が次のどちらの使われ方かを判定してください:

1. 具体的な人物を指す代名詞として適切に使われている
   （例: "my friend and I", "Lehi and I", "my colleague", "my family", "our team" など、
   その文または同じ段落内に具体的な人物・関係性が明示されており、その人たちを指している場合）
   → isVague: false

2. 「人々全般」「社会」「人類」を指す、曖昧で抽象的な主語・目的語・所有格として
   使われている（例: "We often think that technology..." のような、
   TOEFL/IELTSのアカデミックエッセイにありがちな一般論の書き出し）
   → isVague: true

Check if 'we'/'us'/'our' has a specific antecedent (e.g., "my friend and I") anywhere
in the same paragraph. If it refers to specific people, do NOT mark it as vague
(isVague: false). Only mark it as vague (isVague: true) when it is used as a vague,
general pronoun for people/society/humanity in an academic-essay context.

## 重要: 誤検出防止の原則

文章全体が個人的な体験談かアカデミックな論説文か判断に迷う場合、または個々の
occurrenceが具体的な人物を指しているか曖昧な一般論かの判断に迷う場合は、
必ず isVague: false としてください（ハイライトしすぎるより、見逃す方が安全です）。

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
  const limit = checkRateLimit(request);
  if (!limit.ok) return rateLimitResponse(limit);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストボディが不正です。" }, { status: 400 });
  }

  const { text, occurrences } = (body ?? {}) as { text?: unknown; occurrences?: unknown };

  if (!Array.isArray(occurrences) || occurrences.length === 0) {
    return Response.json({ results: [] }, { status: 200 });
  }

  if (typeof text === "string" && text.length > MAX_ANALYZE_LENGTH) {
    return Response.json(
      { error: `解析できるのは${MAX_ANALYZE_LENGTH}文字までです。` },
      { status: 413 },
    );
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

  // 文章全体のトーン（個人的な体験談かアカデミックな論説文か）を判定するために使う。
  const safeDocument =
    typeof text === "string" && text.trim().length > 0
      ? text.trim().slice(0, MAX_DOCUMENT_LENGTH)
      : safeOccurrences.map((o) => o.sentence).join(" ");

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
            content: JSON.stringify({
              document: safeDocument,
              occurrences: safeOccurrences,
            }),
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
