import { contextualPronouns } from "@/data/habit-rules";
import {
  filterSuggestionsForSense,
  getWordSense,
  type WordSense,
} from "@/lib/polysemy";
import { checkRateLimit, rateLimitResponse } from "@/lib/server-rate-limit";

export const runtime = "nodejs";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONTEXT_LENGTH = 500;
const MAX_DOCUMENT_LENGTH = 4000;

type Candidate = { word: string; nuance: string };
type SuccessPayload = {
  explanation: string;
  candidates: Candidate[];
  isTypo?: boolean | null;
  suggestedSpelling?: string | null;
  isVaguePronoun?: boolean | null;
};

const SYSTEM_PROMPT = `あなたはTOEFL / IELTSのアカデミックライティングを指導する英語講師です。
与えられた「対象単語」と、それが使われている「文脈」をもとに、より洗練されたアカデミックな同義語を3つ提案してください。

必ず以下のJSON形式のみで出力してください（前後に説明文や余計なテキストを含めないこと）:
{
  "explanation": "対象単語の文脈における使い方についての簡潔な日本語解説（1〜2文）",
  "isTypo": false,
  "suggestedSpelling": null,
  "isVaguePronoun": false,
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
- word には元の単語と同じ品詞・時制・活用形に近い形の英単語を1語（またはごく短い句）で入れること

## 【最重要】多義語は品詞・文法機能を先に確定させること

候補を考える前に、**対象単語がその文の中でどの品詞・文法機能を果たしているか**を
必ず特定すること。そのうえで、**同じ品詞・同じ文法機能を持つ語句だけ**を
candidates に入れること。品詞が違う候補は、意味が近くても絶対に出さないこと
（置き換えると文が壊れるため）。

判定の手順:
1. 対象単語の直前・直後の語を見て、何を修飾しているか／何を導いているかを決める
2. その働きを別の語で置き換えたときに、文がそのまま成立するかを確認する
3. 成立しない候補は捨てる

### so
- パターンA: **so + 形容詞/副詞**（強調の副詞。very と同じはたらき）
  例: "so ugly" / "so fast" / "so important" / "so much"
  許可: extremely / exceptionally / remarkably / incredibly / particularly
  **禁止: therefore / as a result / consequently / thus（接続詞的表現は絶対に出さないこと）**
  （"He is so ugly" → "He is therefore ugly" は文が壊れるため）
- パターンB: **節 + so + 節**（結果を導く等位接続詞。直前がコンマや文頭で、
  直後に主語＋動詞が続く形）
  例: "It rained, so we stayed home."
  許可: therefore / as a result / consequently / thus
  **禁止: extremely / exceptionally / remarkably / very（強調の副詞は絶対に出さないこと）**
- "so that"（目的）の so は置き換えられないので candidates は [] にすること

### like
- **動詞**（"I like ..." のように主語や助動詞の直後）: enjoy / appreciate / prefer など
  禁止: such as / similar to / comparable to（前置詞句は出さないこと）
- **前置詞**（"countries like Japan" / "It looks like ..."）: such as / similar to /
  comparable to など。禁止: enjoy / prefer / appreciate（動詞は出さないこと）

### well
- **副詞**（動詞や過去分詞を修飾: "works well" / "well known"）:
  effectively / successfully / proficiently。禁止: healthy / in good health / fit
- **形容詞**（体調を表す補語: "I am well"）: healthy / in good health / fit。
  禁止: effectively / successfully / proficiently
- "as well (as)" や文頭の "Well," は置き換えられないので candidates は [] にすること

### as
- **接続詞**（節を導く: "as it was raining"）: because / since / while など。
  禁止: in the role of / such as / like
- **前置詞**（"as a teacher" のように名詞句が続く）: in the role of / in the capacity of など。
  禁止: because / since / while / although（接続詞は出さないこと）
- "as ... as" や "such as" の一部は置き換えられないので candidates は [] にすること

上記以外の多義語（that / since / still / right / just など）も同じ考え方で、
まず品詞を確定し、その品詞に一致する候補だけを出すこと。
- 対象単語が、文脈上あきらかにスペルミス・タイポである可能性が高い場合（例: "leaned" と書かれているが文脈的に "learned" の誤字だと判断できる場合）は、
  "isTypo" を true にし、"suggestedSpelling" に正しい綴りの単語を1語入れること。
  この場合、candidates は「修正後の正しい単語」を基準にした言い換え候補にすること。
  スペルミスの疑いがない場合は "isTypo" を false、"suggestedSpelling" を null にすること。
- 対象単語が "we" / "us" / "our" のいずれかである場合は、まず「文書全体」（渡されていれば）を読み、
  次のどちらのタイプかを判断すること:
  A. 個人的な体験談・エッセイ・志望理由書（Personal Statement）
     一人称（I, my, me）や、具体的な人物・出来事・関係性（例: friend, conversed, talked, team, 固有名詞）
     が含まれ、著者自身の経験を語っている文章。
  B. アカデミックな論説文（「社会」「人々」「人類」について一般論・主張を展開している文章）。

  文書全体がAだと判断した場合、その中の we/us/our は著者自身と具体的な人々を指していると
  考えるのが自然なので、"isVaguePronoun" を false にし、"explanation" でこの使い方は適切で
  言い換えの必要がない旨を述べ、"candidates" は空配列 [] にすること。

  文書全体がBだと判断した場合のみ、対象単語自体の文脈上の使われ方を確認すること:
  Check if 'we'/'us'/'our' has a specific antecedent (e.g., "my friend and I", "Lehi and I", "my colleague", "my family")
  anywhere in the same paragraph. If it refers to specific people, this is a perfectly normal, correct usage — set
  "isVaguePronoun" to false, and in "explanation" state that this usage is fine and no change is needed, with
  "candidates" as an empty array []. Only set "isVaguePronoun" to true when 'we'/'us'/'our' is used as a vague,
  general pronoun for people/society/humanity in an academic-essay context (e.g., "We often think that
  technology..."); in that case provide candidates as usual.

  文書全体のトーンや対象単語の使われ方の判断に迷う場合は、誤検出を避けるため必ず
  "isVaguePronoun" を false にすること（ハイライトしすぎるより見逃す方が安全なため）。
  対象単語が we/us/our 以外の場合は "isVaguePronoun" を false のままにすること。`;

function buildUserPrompt(
  word: string,
  contextSentence: string,
  documentText?: string,
  sense?: WordSense | null,
) {
  const documentPart = documentText
    ? `\n文書全体（トーン判定用）: "${documentText}"`
    : "";

  // クライアント側で文脈から品詞を判定できている場合は、その結果を
  // 制約として明示する（AIの品詞誤認をここで潰す）。
  const sensePart = sense
    ? `\n\n【この "${word}" の文法機能は判定済みです】\n` +
      `- 品詞・働き: ${sense.label}（${sense.role}）\n` +
      (sense.allowed.length > 0
        ? `- この働きに一致する候補のみを出すこと（例: ${sense.allowed.join(" / ")}）\n`
        : "") +
      (sense.forbidden.length > 0
        ? `- 次の語句は品詞が違うため絶対に出さないこと: ${sense.forbidden.join(" / ")}\n`
        : "") +
      (sense.suppress
        ? "- この用法は言い換えの対象にならないため、candidates は [] にすること\n"
        : "")
    : "";

  return `対象単語: "${word}"\n文脈: "${contextSentence}"${documentPart}${sensePart}\n\nこの文脈における "${word}" の、よりアカデミックな言い換え候補を3つ提案してください。`;
}

function isSuccessPayload(value: unknown, allowEmptyCandidates: boolean): value is SuccessPayload {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.explanation !== "string" || obj.explanation.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(obj.candidates)) return false;
  if (obj.candidates.length === 0 && !allowEmptyCandidates) return false;
  const candidatesValid = obj.candidates.every((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const c = candidate as Record<string, unknown>;
    return (
      typeof c.word === "string" &&
      c.word.trim().length > 0 &&
      typeof c.nuance === "string" &&
      c.nuance.trim().length > 0
    );
  });
  if (!candidatesValid) return false;

  if (obj.isTypo !== undefined && obj.isTypo !== null && typeof obj.isTypo !== "boolean") {
    return false;
  }
  if (
    obj.suggestedSpelling !== undefined &&
    obj.suggestedSpelling !== null &&
    typeof obj.suggestedSpelling !== "string"
  ) {
    return false;
  }
  if (
    obj.isVaguePronoun !== undefined &&
    obj.isVaguePronoun !== null &&
    typeof obj.isVaguePronoun !== "boolean"
  ) {
    return false;
  }

  return true;
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

  const { word, contextSentence, documentText, senseId } = (body ?? {}) as {
    word?: unknown;
    contextSentence?: unknown;
    documentText?: unknown;
    senseId?: unknown;
  };

  if (typeof word !== "string" || word.trim().length === 0) {
    return Response.json({ error: "word は必須です。" }, { status: 400 });
  }

  // 多義語の品詞（クライアントが本文中の位置から判定した結果）。
  // 定義はサーバー側の表を正とし、IDだけを受け取る。
  const sense =
    typeof senseId === "string" && senseId.length <= 64 ? getWordSense(senseId) : null;
  const isSenseValid = sense?.word === word.trim().toLowerCase() ? sense : null;

  // 言い換えの対象にならない用法（"so that" / "as well as" など）は、
  // AIを呼ばずにその旨だけを返す。
  if (isSenseValid?.suppress) {
    return Response.json(
      { explanation: isSenseValid.insight, candidates: [] },
      { status: 200 },
    );
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

  const safeDocument =
    typeof documentText === "string" && documentText.trim().length > 0
      ? documentText.trim().slice(0, MAX_DOCUMENT_LENGTH)
      : undefined;

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
          {
            role: "user",
            content: buildUserPrompt(word, safeContext, safeDocument, isSenseValid),
          },
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

    const isContextualPronoun = contextualPronouns.has(word.toLowerCase());

    if (!isSuccessPayload(parsed, isContextualPronoun || Boolean(isSenseValid))) {
      console.error("OpenAI JSON content failed shape validation:", parsed);
      return Response.json(
        { error: "AIの応答が期待した形式ではありませんでした。" },
        { status: 502 },
      );
    }

    const suggestedSpelling = parsed.suggestedSpelling?.trim();
    const isTypo = parsed.isTypo === true && Boolean(suggestedSpelling);
    const isVaguePronoun = isContextualPronoun ? parsed.isVaguePronoun === true : undefined;

    // 品詞が確定している多義語では、その品詞に合わない候補（強調の副詞 so に
    // 対する "therefore" など）をここで必ず落とす。全て落ちた場合は、
    // 品詞に一致する既定の候補に差し替える。
    let candidates = parsed.candidates;
    if (isSenseValid) {
      candidates = filterSuggestionsForSense(isSenseValid, candidates);
      if (candidates.length === 0) candidates = isSenseValid.suggestions;
    }

    return Response.json(
      {
        explanation: parsed.explanation,
        candidates: candidates.slice(0, 3),
        ...(isTypo ? { isTypo: true, suggestedSpelling } : {}),
        ...(isContextualPronoun ? { isVaguePronoun } : {}),
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
