import { habitRuleMap, type HabitRule } from "@/data/habit-rules";

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
      rule: HabitRule;
    };

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const wordPattern = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;

    if (start > lastIndex) {
      tokens.push({
        type: "text",
        key: `t-${lastIndex}`,
        text: text.slice(lastIndex, start),
      });
    }

    const rule = habitRuleMap.get(word.toLowerCase());
    tokens.push(
      rule
        ? { type: "word", key: `w-${start}`, text: word, start, end, rule }
        : { type: "text", key: `t-${start}`, text: word },
    );

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
