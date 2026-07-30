import { habitRuleMap, type HabitRule } from "@/data/habit-rules";
import { isUnknownWord } from "@/lib/spellcheck";

export type AiTypoInfo = {
  suggestedSpelling: string;
  explanation: string;
};

export type Token =
  | {
      type: "text";
      key: string;
      text: string;
    }
  | {
      type: "word";
      key: string;
      text: string;
      start: number;
      end: number;
      rule?: HabitRule;
      isUnknownWord?: boolean;
      isAiTypo?: boolean;
      aiSuggestedSpelling?: string;
      aiExplanation?: string;
    };

const SENTENCE_END_PATTERN = /[.!?]/;

export function tokenize(text: string, dictionary?: Set<string> | null): Token[] {
  const tokens: Token[] = [];
  const wordPattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let atSentenceStart = true;

  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;

    if (start > lastIndex) {
      const gap = text.slice(lastIndex, start);
      tokens.push({ type: "text", key: `t-${lastIndex}`, text: gap });
      if (SENTENCE_END_PATTERN.test(gap)) atSentenceStart = true;
    }

    const rule = habitRuleMap.get(word.toLowerCase());
    tokens.push({
      type: "word",
      key: `w-${start}`,
      text: word,
      start,
      end,
      rule,
      isUnknownWord:
        !rule && dictionary ? isUnknownWord(word, atSentenceStart, dictionary) : false,
    });

    atSentenceStart = false;
    lastIndex = end;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: "text",
      key: `t-${lastIndex}`,
      text: text.slice(lastIndex),
    });
  }

  return tokens;
}

/**
 * AI（文脈チェック）が「実在するが文脈上誤り」と確認済みの単語（小文字化
 * した単語文字列がキー）を、対応する word トークンに反映する。
 * コーパスルール単語（rule 付き）は対象外とする。
 */
export function applyAiTypoFlags(
  tokens: Token[],
  aiTypos: Map<string, AiTypoInfo>,
): Token[] {
  if (aiTypos.size === 0) return tokens;

  return tokens.map((token) => {
    if (token.type !== "word" || token.rule) return token;

    const match = aiTypos.get(token.text.toLowerCase());
    if (!match) return token;

    return {
      ...token,
      isAiTypo: true,
      aiSuggestedSpelling: match.suggestedSpelling,
      aiExplanation: match.explanation,
    };
  });
}

const MAX_CONTEXT_LENGTH = 500;

/**
 * `position` を含む一文を、文末記号（. ! ?）を区切りとして抽出する。
 * 文境界が見つからない場合はテキスト全体（上限あり）を返す。
 */
export function getContextSentence(text: string, position: number): string {
  const trimmedFull = text.trim();
  if (!trimmedFull) return "";

  const boundaryPattern = /[.!?](?:\s+|$)/g;
  let sentenceStart = 0;
  let match: RegExpExecArray | null;

  while ((match = boundaryPattern.exec(text)) !== null) {
    const sentenceEnd = match.index + match[0].length;
    if (position < sentenceEnd) {
      const sentence = text.slice(sentenceStart, sentenceEnd).trim();
      return (sentence || trimmedFull).slice(0, MAX_CONTEXT_LENGTH);
    }
    sentenceStart = sentenceEnd;
  }

  const remainder = text.slice(sentenceStart).trim();
  return (remainder || trimmedFull).slice(0, MAX_CONTEXT_LENGTH);
}

export function matchCase(source: string, target: string): string {
  if (!source) return target;

  const isAllUpper = source === source.toUpperCase() && source !== source.toLowerCase();
  if (isAllUpper) return target.toUpperCase();

  const isCapitalized = source[0] === source[0].toUpperCase();
  if (isCapitalized) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }

  return target;
}
