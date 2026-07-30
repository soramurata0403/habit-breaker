"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { getContextSentence, matchCase, type Token } from "@/lib/tokenize";
import { suggestCorrections } from "@/lib/spellcheck";
import { fetchWordInsight, type WordInsight } from "@/lib/word-insight";
import type { Suggestion } from "@/data/habit-rules";

type WordTokenProps = {
  token: Extract<Token, { type: "word" }>;
  fullText: string;
  dictionary: Set<string> | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (start: number, end: number, replacement: string) => void;
};

export function WordToken({
  token,
  fullText,
  dictionary,
  isOpen,
  onOpenChange,
  onReplace,
}: WordTokenProps) {
  const isHighlighted = Boolean(token.rule);
  const isTypoFlagged = Boolean(token.isUnknownWord);

  function handlePick(replacement: string) {
    onReplace(token.start, token.end, matchCase(token.text, replacement));
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            // padding/margin/border は一切持たせない: textarea 側の文字幅と
            // 完全に一致させるため（背景色・ring は box-shadow ベースでレイアウトに影響しない）。
            "pointer-events-auto m-0 rounded border-0 p-0 align-baseline transition-colors",
            isTypoFlagged
              ? cn(
                  "bg-red-100/80 underline decoration-red-500 decoration-2 decoration-wavy underline-offset-4 hover:bg-red-200/80",
                  isOpen && "bg-red-200 ring-2 ring-red-400",
                )
              : isHighlighted
                ? cn(
                    "bg-amber-100/80 underline decoration-amber-500 decoration-2 decoration-dotted underline-offset-4 hover:bg-amber-200/80",
                    isOpen && "bg-amber-200 ring-2 ring-amber-400",
                  )
                : cn("hover:bg-teal-50", isOpen && "bg-teal-50 ring-2 ring-teal-200"),
          )}
        >
          {token.text}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={16}
          className="animate-popover z-50 w-[21rem] rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-xl focus:outline-none"
        >
          {token.rule ? (
            <InsightCard
              badgeLabel="オーバーユース単語"
              badgeClassName="bg-amber-100 text-amber-800"
              headword={token.rule.word}
              insight={token.rule.insight}
              suggestions={token.rule.suggestions}
              onPick={handlePick}
            />
          ) : (
            <DynamicInsight
              isOpen={isOpen}
              word={token.text}
              start={token.start}
              fullText={fullText}
              isTypoFlagged={isTypoFlagged}
              dictionary={dictionary}
              onPick={handlePick}
            />
          )}
          <Popover.Arrow className="fill-white" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function buildLocalTypoInsight(word: string, dictionary: Set<string>): WordInsight {
  const suggestions = suggestCorrections(word, dictionary, 3);
  const topSuggestion = suggestions[0];

  return {
    word: word.toLowerCase(),
    source: "typo-local",
    badgeLabel: "スペルチェック",
    insight: topSuggestion
      ? `"${word}" は辞書に見つかりませんでした。スペルミスの可能性があります。`
      : `"${word}" は辞書に見つかりませんでした。近い綴りの候補も見つかりませんでした。`,
    suggestions: [],
    ...(topSuggestion ? { isTypo: true, suggestedSpelling: topSuggestion } : {}),
  };
}

function DynamicInsight({
  isOpen,
  word,
  start,
  fullText,
  isTypoFlagged,
  dictionary,
  onPick,
}: {
  isOpen: boolean;
  word: string;
  start: number;
  fullText: string;
  isTypoFlagged: boolean;
  dictionary: Set<string> | null;
  onPick: (replacement: string) => void;
}) {
  const [insight, setInsight] = useState<WordInsight | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const contextSentence = getContextSentence(fullText, start);
    fetchWordInsight(word, contextSentence).then((result) => {
      if (cancelled) return;
      // 赤色判定済みの単語で、AI側が「データなし」しか返せなかった場合は、
      // クライアント側の修正候補（localFallback）の方が有用なので上書きしない。
      if (isTypoFlagged && result.source === "unknown") return;
      setInsight(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, word, start, fullText, isTypoFlagged]);

  // 赤色（辞書に無い語）と判定済みの単語は、AIの応答を待たずに
  // クライアント側の編集距離ベースの候補を即座に表示する（リアルタイム性を優先）。
  // AIの応答が届き次第（fetchWordInsight → insight state）、より文脈に即した内容に置き換わる。
  const localFallback = useMemo(
    () => (isTypoFlagged && dictionary ? buildLocalTypoInsight(word, dictionary) : null),
    [isTypoFlagged, dictionary, word],
  );

  const resolved =
    insight && insight.word === word.toLowerCase() ? insight : localFallback;

  if (!resolved) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        AIが文脈を解析中...
      </div>
    );
  }

  return (
    <InsightCard
      badgeLabel={resolved.badgeLabel}
      badgeClassName={
        resolved.source === "typo-local"
          ? "bg-red-100 text-red-800"
          : resolved.source === "ai"
            ? "bg-indigo-100 text-indigo-800"
            : resolved.source === "generic"
              ? "bg-teal-100 text-teal-800"
              : "bg-neutral-100 text-neutral-500"
      }
      headword={resolved.word}
      insight={resolved.insight}
      suggestions={resolved.suggestions}
      onPick={onPick}
      emptyMessage="この単語にはまだ言い換え候補がありません。"
      isTypo={resolved.isTypo}
      suggestedSpelling={resolved.suggestedSpelling}
    />
  );
}

function InsightCard({
  badgeLabel,
  badgeClassName,
  headword,
  insight,
  suggestions,
  onPick,
  emptyMessage,
  isTypo,
  suggestedSpelling,
}: {
  badgeLabel: string;
  badgeClassName: string;
  headword: string;
  insight: string;
  suggestions: Suggestion[];
  onPick: (replacement: string) => void;
  emptyMessage?: string;
  isTypo?: boolean;
  suggestedSpelling?: string;
}) {
  return (
    <div>
      {isTypo && suggestedSpelling && (
        <button
          type="button"
          onClick={() => onPick(suggestedSpelling)}
          className="mb-3 flex w-full items-center justify-between gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left transition-colors hover:border-red-400 hover:bg-red-100"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-red-800">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            スペルミスの可能性があります: &quot;{suggestedSpelling}&quot;
          </span>
          <span className="shrink-0 rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white">
            修正する
          </span>
        </button>
      )}
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            badgeClassName,
          )}
        >
          <Sparkles className="h-3 w-3" />
          {badgeLabel}
        </span>
        <span className="font-mono text-sm font-semibold text-neutral-900">
          {headword}
        </span>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-neutral-600">{insight}</p>

      {suggestions.length > 0 ? (
        <>
          <p className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
            言い換え候補
          </p>
          <div className="space-y-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.word}
                type="button"
                onClick={() => onPick(suggestion.word)}
                className="group flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left transition-colors hover:border-teal-400 hover:bg-teal-50"
              >
                <span className="flex items-center gap-1.5">
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-300 transition-colors group-hover:text-teal-500" />
                  <span className="font-medium text-neutral-900">
                    {suggestion.word}
                  </span>
                </span>
                <span className="text-xs text-neutral-500">{suggestion.nuance}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        !isTypo &&
        emptyMessage && <p className="text-xs text-neutral-400">{emptyMessage}</p>
      )}
    </div>
  );
}
