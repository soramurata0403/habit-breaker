import type { HabitRule, Suggestion } from "@/data/habit-rules";

/**
 * 多義語（品詞によって意味が変わる語）の文法機能を文脈から判定するモジュール。
 *
 * 例: "Saku is so ugly" の "so" は形容詞を強める副詞（＝very）だが、
 *     "It rained, so we stayed home" の "so" は結果を導く接続詞。
 * 前者に therefore / as a result を提案すると "is therefore ugly" となり
 * 文が壊れるため、品詞ごとに提案できる候補を分けて持つ。
 *
 * サーバー（/api/word-insight, /api/text-scan）とクライアント（tokenize,
 * word-insight）の両方から参照し、「どの品詞のときに何を出してよいか」の
 * 定義を1か所にまとめている。
 */

export type WordSense = {
  /** 用法の識別子。クライアント→APIへはこのIDだけを渡す。例: "so:intensifier" */
  id: string;
  /** 対象の語（小文字）。 */
  word: string;
  /** 日本語での用法名（解説の見出しに使う）。 */
  label: string;
  /** 英語での文法機能の説明（AIプロンプトに渡す）。 */
  role: string;
  /** この用法のときにポップオーバーへ出す日本語の解説。 */
  insight: string;
  /** この用法で提案する言い換え候補（AIの候補が全て弾かれた場合の代替にもなる）。 */
  suggestions: Suggestion[];
  /** この用法で許容される語彙（プロンプトに渡す。suggestions より広い場合がある）。 */
  allowed: readonly string[];
  /** この用法では絶対に出してはいけない語句（他の品詞の言い換え）。 */
  forbidden: readonly string[];
  /** true の場合、そもそも言い換えを提案しない（固定表現・機能語の一部）。 */
  suppress?: boolean;
};

// so を「強調の副詞」として使っている箇所に出してはいけない接続詞的表現。
const CONNECTIVES = [
  "therefore",
  "as a result",
  "consequently",
  "thus",
  "hence",
  "accordingly",
  "for this reason",
  "that is why",
] as const;

// so を「結果の接続詞」として使っている箇所に出してはいけない強調副詞。
const INTENSIFIERS = [
  "extremely",
  "exceptionally",
  "remarkably",
  "incredibly",
  "particularly",
  "very",
  "really",
  "quite",
  "highly",
] as const;

const SENSES: Record<string, WordSense> = {
  "so:intensifier": {
    id: "so:intensifier",
    word: "so",
    label: "強調の副詞",
    role: "an intensifying adverb modifying an adjective or adverb (the same function as 'very')",
    insight:
      "ここでの so は直後の形容詞・副詞を強める副詞（very と同じはたらき）です。話し言葉的な強調なので、程度を具体的に示す副詞へ言い換えましょう。",
    suggestions: [
      { word: "extremely", nuance: "極めて（度合いが非常に高い）" },
      { word: "exceptionally", nuance: "並外れて・例外的に" },
      { word: "remarkably", nuance: "著しく・目立って" },
      { word: "particularly", nuance: "とりわけ・特に" },
    ],
    allowed: ["extremely", "exceptionally", "remarkably", "incredibly", "particularly"],
    forbidden: CONNECTIVES,
  },
  "so:conjunction": {
    id: "so:conjunction",
    word: "so",
    label: "結果を表す接続詞",
    role: "a coordinating conjunction introducing a result clause (equivalent to 'therefore')",
    insight:
      "ここでの so は「だから」と結果を導く接続詞です。文中で接続詞の so を連発するのは口語の癖なので、書き言葉用の論理接続詞に言い換えましょう。",
    suggestions: [
      { word: "therefore", nuance: "それゆえに（硬い論理）" },
      { word: "as a result", nuance: "結果として" },
      { word: "consequently", nuance: "結果に伴って" },
    ],
    allowed: ["therefore", "as a result", "consequently", "thus"],
    forbidden: INTENSIFIERS,
  },
  "so:purpose": {
    id: "so:purpose",
    word: "so",
    label: "目的を表す so that の一部",
    role: "part of the purpose conjunction 'so that'",
    insight:
      "ここでの so は「〜するために」を表す so that の一部です。so だけを別の語に置き換えると意味が壊れるため、言い換えの必要はありません。",
    suggestions: [],
    allowed: [],
    forbidden: [...CONNECTIVES, ...INTENSIFIERS],
    suppress: true,
  },

  "like:verb": {
    id: "like:verb",
    word: "like",
    label: "「好む」を表す動詞",
    role: "a main verb meaning 'to enjoy / to be fond of'",
    insight:
      "ここでの like は「好む」を表す動詞です。動詞として置き換えられる語のみを選びましょう。",
    suggestions: [
      { word: "enjoy", nuance: "楽しむ・享受する" },
      { word: "appreciate", nuance: "良さを認めて評価する" },
      { word: "prefer", nuance: "他よりも好む" },
    ],
    allowed: ["enjoy", "appreciate", "prefer", "favor", "value"],
    forbidden: ["such as", "similar to", "comparable to", "resembling", "akin to", "for example"],
  },
  "like:preposition": {
    id: "like:preposition",
    word: "like",
    label: "「〜のような」を表す前置詞",
    role: "a preposition meaning 'such as' or 'similar to'",
    insight:
      "ここでの like は「〜のような」を表す前置詞です。動詞ではないので、前置詞として働く表現に言い換えましょう。",
    suggestions: [
      { word: "such as", nuance: "例を挙げるときの〜など" },
      { word: "similar to", nuance: "〜に似た" },
      { word: "comparable to", nuance: "〜に匹敵する" },
    ],
    allowed: ["such as", "similar to", "comparable to", "resembling", "akin to"],
    forbidden: ["enjoy", "appreciate", "prefer", "favor", "favour", "admire", "love"],
  },

  "well:adverb": {
    id: "well:adverb",
    word: "well",
    label: "動詞を修飾する副詞",
    role: "an adverb modifying a verb or participle ('performs well', 'well known')",
    insight:
      "ここでの well は動詞・分詞を修飾する副詞です。体調を表す形容詞の well とは別物なので、副詞に言い換えましょう。",
    suggestions: [
      { word: "effectively", nuance: "効果的に" },
      { word: "successfully", nuance: "首尾よく" },
      { word: "proficiently", nuance: "熟達して" },
    ],
    allowed: ["effectively", "successfully", "proficiently", "skillfully", "competently"],
    forbidden: ["healthy", "in good health", "fine", "fit", "recovered", "sound"],
  },
  "well:adjective": {
    id: "well:adjective",
    word: "well",
    label: "体調を表す形容詞",
    role: "a predicative adjective describing health ('I am well')",
    insight:
      "ここでの well は「健康な」を表す形容詞です。動詞を修飾する副詞の well とは別物なので、形容詞に言い換えましょう。",
    suggestions: [
      { word: "healthy", nuance: "健康な" },
      { word: "in good health", nuance: "健康状態が良い" },
      { word: "fit", nuance: "体調が整っている" },
    ],
    allowed: ["healthy", "in good health", "fit", "recovered"],
    forbidden: ["effectively", "successfully", "proficiently", "skillfully", "thoroughly"],
  },
  "well:fixed": {
    id: "well:fixed",
    word: "well",
    label: "固定表現・間投詞",
    role: "part of the fixed phrase 'as well (as)' or a sentence-initial discourse marker",
    insight:
      "ここでの well は「as well (as)」の一部、または文頭の間投詞です。単独で置き換えると意味が壊れるため、言い換えの対象にはなりません（文頭の Well, はアカデミックな文章では削除しましょう）。",
    suggestions: [],
    allowed: [],
    forbidden: [
      "effectively",
      "successfully",
      "proficiently",
      "healthy",
      "in good health",
      "fit",
    ],
    suppress: true,
  },

  "as:conjunction": {
    id: "as:conjunction",
    word: "as",
    label: "理由・同時性を表す接続詞",
    role: "a subordinating conjunction introducing a clause (reason or simultaneity)",
    insight:
      "ここでの as は節を導く接続詞（〜なので／〜するとき）です。前置詞の as（〜として）とは別物なので、接続詞に言い換えましょう。",
    suggestions: [
      { word: "because", nuance: "理由を明示する" },
      { word: "since", nuance: "既知の理由を示す" },
      { word: "while", nuance: "〜する間に（同時性）" },
    ],
    allowed: ["because", "since", "while", "when", "given that"],
    forbidden: ["in the role of", "in the capacity of", "such as", "like", "similar to"],
  },
  "as:preposition": {
    id: "as:preposition",
    word: "as",
    label: "「〜として」を表す前置詞",
    role: "a preposition meaning 'in the role of'",
    insight:
      "ここでの as は「〜として」を表す前置詞です。理由を表す接続詞の as とは別物なので、前置詞として働く表現だけが候補になります。",
    suggestions: [],
    allowed: ["in the role of", "in the capacity of", "serving as"],
    forbidden: ["because", "since", "while", "when", "although", "though", "given that"],
  },
  "as:fixed": {
    id: "as:fixed",
    word: "as",
    label: "固定表現の一部",
    role: "part of a fixed construction ('as ... as', 'such as')",
    insight:
      "ここでの as は「as ... as」や「such as」といった固定表現の一部です。as だけを置き換えると表現が壊れるため、言い換えの対象にはなりません。",
    suggestions: [],
    allowed: [],
    forbidden: ["because", "since", "while", "when", "although", "in the role of"],
    suppress: true,
  },
};

/** 判定対象の多義語（小文字）。 */
export const POLYSEMOUS_WORDS: ReadonlySet<string> = new Set(["so", "like", "well", "as"]);

export function getWordSense(id: string): WordSense | null {
  return SENSES[id] ?? null;
}

// --- 文脈を読むための小さなヘルパー ---------------------------------------

const WORD_BEFORE = /([A-Za-z]+(?:['’][A-Za-z]+)*)[^A-Za-z]*$/;
const WORD_AFTER = /^[^A-Za-z]*([A-Za-z]+(?:['’][A-Za-z]+)*)/;
const CONTEXT_WINDOW = 80;

function precedingWord(text: string, index: number): string {
  const match = text.slice(Math.max(0, index - CONTEXT_WINDOW), index).match(WORD_BEFORE);
  return match ? match[1].toLowerCase() : "";
}

function followingWord(text: string, index: number): string {
  const match = text.slice(index, index + CONTEXT_WINDOW).match(WORD_AFTER);
  return match ? match[1].toLowerCase() : "";
}

const COORDINATORS = new Set(["and", "but", "yet", "or"]);

/** 直前が文頭・句読点・等位接続詞（＝新しい節が始まる位置）かどうか。 */
function isAtClauseBoundary(text: string, index: number): boolean {
  const before = text.slice(0, index).replace(/\s+$/, "");
  if (!before) return true;
  if (",;:.!?—–".includes(before[before.length - 1])) return true;
  return COORDINATORS.has(precedingWord(text, index));
}

// 直後に来ていれば新しい節が始まっているとみなせる語（主語になり得る語）。
const CLAUSE_STARTERS = new Set([
  "i", "we", "you", "they", "he", "she", "it", "there",
  "this", "these", "those", "the", "a", "an", "one",
  "my", "your", "his", "her", "its", "our", "their",
  "people", "students", "society", "everyone", "everybody",
  "someone", "somebody", "nobody", "no", "government", "companies",
  "who", "what", "when", "where", "why", "how",
]);

// 直前にあれば "so" が形容詞・副詞を修飾していると判断できる連結動詞。
const COPULA_VERBS = new Set([
  "is", "are", "was", "were", "am", "be", "been", "being",
  "isn't", "aren't", "wasn't", "weren't",
  "seem", "seems", "seemed", "look", "looks", "looked",
  "feel", "feels", "felt", "become", "becomes", "became",
  "sound", "sounds", "sounded", "appear", "appears", "appeared",
  "remain", "remains", "remained", "stay", "stays", "stayed",
  "taste", "tastes", "tasted", "smell", "smells", "smelled",
]);

// "so much" / "so many" のように、直後に来れば必ず強調（度合い）になる語。
const DEGREE_FOLLOWERS = new Set([
  "much", "many", "few", "little", "far", "long", "often", "fast", "hard", "well", "soon",
]);

const ADJECTIVE_SUFFIX = /(ly|ous|ful|ive|able|ible|ical|ic|ish|less|ant|ent|ary|ory|y)$/;

// 接尾辞では判定できない高頻度の形容詞・副詞。
const COMMON_ADJECTIVES = new Set([
  "good", "bad", "big", "small", "hot", "cold", "tired", "sad", "glad", "kind",
  "rich", "poor", "young", "old", "weak", "strong", "free", "safe", "sick",
  "great", "huge", "tiny", "deep", "wide", "close", "clear", "clean", "dark",
  "light", "heavy", "cheap", "easy", "slow", "high", "low", "short", "nice",
  "mean", "rude", "calm", "proud", "brave", "smart", "cute", "fine", "real",
  "true", "false", "sure", "quick", "strange", "simple", "complex", "tough",
  "rough", "smooth", "sweet", "bitter", "warm", "cool", "wet", "dry", "full",
  "empty", "new", "rare", "keen", "fond", "aware", "afraid", "alike", "alone",
]);

function looksAdjectival(word: string): boolean {
  if (!word) return false;
  if (COMMON_ADJECTIVES.has(word)) return true;
  if (CLAUSE_STARTERS.has(word)) return false;
  return ADJECTIVE_SUFFIX.test(word);
}

// 過去分詞・形容詞が続いていれば well は副詞（"well known" / "well designed"）。
const PARTICIPLE_SUFFIX = /(ed|ing|en)$/;
const KNOWN_PARTICIPLES = new Set([
  "known", "aware", "established", "documented", "suited", "written", "made",
  "done", "built", "kept", "spent", "read", "paid", "worth", "past", "beyond",
]);

// like の直前にあれば動詞（「好む」）だと判断できる語。
const LIKE_SUBJECTS = new Set([
  "i", "we", "you", "they", "he", "she", "it", "who", "people", "students",
  "children", "everyone", "everybody", "someone", "somebody", "americans",
]);
const LIKE_AUXILIARIES = new Set([
  "do", "does", "did", "don't", "doesn't", "didn't", "would", "will", "won't",
  "may", "might", "must", "can", "can't", "could", "should", "to", "not",
  "really", "also", "always", "still", "never", "generally", "usually", "and",
]);
// like の直前にあれば前置詞（「〜のような」）だと判断できる語。
const LIKE_PREPOSITION_CUES = new Set([
  "is", "are", "was", "were", "am", "be", "been", "being",
  "look", "looks", "looked", "sound", "sounds", "sounded",
  "feel", "feels", "felt", "seem", "seems", "seemed",
  "act", "acts", "acted", "behave", "behaves", "behaved", "treat", "treats", "treated",
  "just", "much", "exactly", "more", "something", "anything", "nothing", "somewhat",
]);

const DETERMINERS = new Set([
  "a", "an", "the", "my", "your", "his", "her", "its", "our", "their",
  "this", "that", "these", "those",
]);
const SUBJECT_PRONOUNS = new Set(["i", "we", "you", "they", "he", "she", "it"]);

// 比較構文 "as ... as" の2つめの as を見分けるためのパターン
// （直前に "as" ＋ 1〜3語が続いている形）。
const COMPARATIVE_TAIL = /\bas\s+(?:[A-Za-z]+(?:['’][A-Za-z]+)*\s+){1,3}$/i;

// --- 用法の判定 -------------------------------------------------------------

function resolveSo(text: string, start: number, end: number): WordSense {
  const next = followingWord(text, end);
  const previous = precedingWord(text, start);

  // 文末の "so"（"…, and so." など）は接続詞的な使い方とみなす。
  if (!next) return SENSES["so:conjunction"];
  // "so that ..."（目的）は so だけを置き換えられない。
  if (next === "that") return SENSES["so:purpose"];
  // "so much" / "so many" などは必ず度合いの強調。
  if (DEGREE_FOLLOWERS.has(next)) return SENSES["so:intensifier"];
  // 直後に主語になり得る語が来ていれば、新しい節を導く接続詞。
  if (CLAUSE_STARTERS.has(next)) return SENSES["so:conjunction"];
  // "is so ugly" のように連結動詞の直後なら、補語を強める副詞。
  if (COPULA_VERBS.has(previous)) return SENSES["so:intensifier"];
  // 直後が形容詞・副詞なら強調の副詞。
  if (looksAdjectival(next)) return SENSES["so:intensifier"];
  // 節の切れ目（文頭・コンマ・and/but の直後）にあれば接続詞。
  if (isAtClauseBoundary(text, start)) return SENSES["so:conjunction"];
  return SENSES["so:intensifier"];
}

function resolveLike(text: string, start: number, end: number): WordSense | null {
  const previous = precedingWord(text, start);

  if (LIKE_PREPOSITION_CUES.has(previous)) return SENSES["like:preposition"];
  if (LIKE_SUBJECTS.has(previous) || LIKE_AUXILIARIES.has(previous)) {
    return SENSES["like:verb"];
  }
  // 文頭の "Like many students, ..." は前置詞。
  if (!previous && followingWord(text, end)) return SENSES["like:preposition"];
  // 判断材料が無い場合は制約をかけない（誤判定の方が害が大きいため）。
  return null;
}

function resolveWell(text: string, start: number, end: number): WordSense | null {
  const previous = precedingWord(text, start);
  const next = followingWord(text, end);

  // "as well" / "as well as" は固定表現。
  if (previous === "as") return SENSES["well:fixed"];
  // 文頭の "Well, ..." は会話的な間投詞。
  if (isAtClauseBoundary(text, start) && text.slice(end).trimStart().startsWith(",")) {
    return SENSES["well:fixed"];
  }
  // "well known" / "well designed" のように分詞・形容詞が続けば副詞。
  if (next && (KNOWN_PARTICIPLES.has(next) || PARTICIPLE_SUFFIX.test(next))) {
    return SENSES["well:adverb"];
  }
  // "I am well" / "feel well" のように連結動詞の補語なら形容詞。
  if (COPULA_VERBS.has(previous)) return SENSES["well:adjective"];
  return SENSES["well:adverb"];
}

function resolveAs(text: string, start: number, end: number): WordSense | null {
  const previous = precedingWord(text, start);
  const next = followingWord(text, end);

  // "such as" / "as ... as" の一部。
  if (previous === "such" || previous === "as") return SENSES["as:fixed"];
  if (next === "as") return SENSES["as:fixed"];
  if (looksAdjectival(next) && / as\b/i.test(text.slice(end, end + CONTEXT_WINDOW))) {
    return SENSES["as:fixed"];
  }
  // 比較構文 "as ... as" の2つめの as（直前に as ＋ 数語がある）。
  if (COMPARATIVE_TAIL.test(text.slice(Math.max(0, start - CONTEXT_WINDOW), start))) {
    return SENSES["as:fixed"];
  }
  // "as it was raining" のように節が続けば接続詞。
  if (SUBJECT_PRONOUNS.has(next)) return SENSES["as:conjunction"];
  // "as a teacher" のように名詞句が続けば前置詞。
  if (DETERMINERS.has(next)) return SENSES["as:preposition"];
  // 大文字で始まる語（固有名詞）が続く場合も前置詞（"as Japan does" は稀）。
  if (next && /^[A-Z]/.test(text.slice(end).match(WORD_AFTER)?.[1] ?? "")) {
    return SENSES["as:preposition"];
  }
  return null;
}

/**
 * `text` の `start` 位置にある多義語が、その文脈でどの品詞・文法機能として
 * 使われているかを判定する。多義語でない場合や判断がつかない場合は null。
 */
export function resolveWordSense(
  rawWord: string,
  text: string,
  start: number,
): WordSense | null {
  const word = rawWord.toLowerCase();
  if (!POLYSEMOUS_WORDS.has(word)) return null;
  if (typeof start !== "number" || start < 0 || start >= text.length) return null;
  // 想定した位置に本当にその語があるかを確認する（本文が編集された場合の保険）。
  if (text.slice(start, start + word.length).toLowerCase() !== word) return null;

  const end = start + word.length;
  switch (word) {
    case "so":
      return resolveSo(text, start, end);
    case "like":
      return resolveLike(text, start, end);
    case "well":
      return resolveWell(text, start, end);
    case "as":
      return resolveAs(text, start, end);
    default:
      return null;
  }
}

// --- 候補のフィルタリング ---------------------------------------------------

function normalizeTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** その用法で出してはいけない候補かどうか。 */
export function isForbiddenForSense(sense: WordSense, candidate: string): boolean {
  const normalized = normalizeTerm(candidate);
  if (!normalized) return false;
  return sense.forbidden.some((term) => {
    const forbidden = normalizeTerm(term);
    return (
      normalized === forbidden ||
      normalized.startsWith(`${forbidden} `) ||
      normalized.endsWith(` ${forbidden}`)
    );
  });
}

/**
 * コーパスルールを、その出現箇所の品詞に合わせた内容へ差し替える。
 * 言い換えの対象にならない用法（"so that" など）では undefined を返し、
 * ハイライト自体を行わないようにする。
 */
export function applySenseToRule(
  rule: HabitRule,
  sense: WordSense | null,
): HabitRule | undefined {
  if (!sense) return rule;
  if (sense.suppress) return undefined;
  return { word: rule.word, insight: sense.insight, suggestions: sense.suggestions };
}

/** 用法に合わない候補を取り除く。 */
export function filterSuggestionsForSense<T extends { word: string }>(
  sense: WordSense,
  suggestions: T[],
): T[] {
  if (sense.suppress) return [];
  return suggestions.filter((suggestion) => !isForbiddenForSense(sense, suggestion.word));
}

/**
 * 置換対象の範囲 [start, end) に多義語が含まれている場合、その用法に
 * 合わない置換案かどうかを判定し、違反していれば該当する語句を返す。
 *
 * 例: "is so ugly" の "so"（強調の副詞）を "therefore" に置き換える指摘は、
 *     適用すると "is therefore ugly" になるため弾く。
 */
export function findSenseViolation(
  text: string,
  start: number,
  phrase: string,
  correction: string,
): { word: string; sense: WordSense; term: string } | null {
  const pattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(phrase)) !== null) {
    const word = match[0].toLowerCase();
    if (!POLYSEMOUS_WORDS.has(word)) continue;

    const sense = resolveWordSense(word, text, start + match.index);
    if (!sense) continue;

    const term = sense.forbidden.find((forbidden) => {
      const normalized = normalizeTerm(forbidden);
      const normalizedCorrection = normalizeTerm(correction);
      return (
        normalizedCorrection === normalized ||
        normalizedCorrection.startsWith(`${normalized} `) ||
        normalizedCorrection.endsWith(` ${normalized}`) ||
        normalizedCorrection.includes(` ${normalized} `)
      );
    });
    if (term) return { word, sense, term };
  }
  return null;
}
