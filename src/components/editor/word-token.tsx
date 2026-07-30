"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { getContextSentence, matchCase, type Token } from "@/lib/tokenize";
import { fetchWordInsight, type WordInsight } from "@/lib/word-insight";
import type { Suggestion } from "@/data/habit-rules";

type WordTokenProps = {
  token: Extract<Token, { type: "word" }>;
  fullText: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (start: number, end: number, replacement: string) => void;
};

export function WordToken({
  token,
  fullText,
  isOpen,
  onOpenChange,
  onReplace,
}: WordTokenProps) {
  const isHighlighted = Boolean(token.rule);

  function handlePick(replacement: string) {
    onReplace(token.start, token.end, matchCase(token.text, replacement));
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "pointer-events-auto rounded px-0.5 transition-colors",
            isHighlighted
              ? cn(
                  "bg-amber-100/80 underline decoration-amber-500 decoration-2 decoration-dotted underline-offset-4 hover:bg-amber-200/80",
                  isOpen && "bg-amber-200 ring-2 ring-amber-400",
                )
              : cn(
                  "hover:bg-teal-50",
                  isOpen && "bg-teal-50 ring-2 ring-teal-200",
                ),
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
              onPick={handlePick}
            />
          )}
          <Popover.Arrow className="fill-white" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DynamicInsight({
  isOpen,
  word,
  start,
  fullText,
  onPick,
}: {
  isOpen: boolean;
  word: string;
  start: number;
  fullText: string;
  onPick: (replacement: string) => void;
}) {
  const [insight, setInsight] = useState<WordInsight | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const contextSentence = getContextSentence(fullText, start);
    fetchWordInsight(word, contextSentence).then((result) => {
      if (!cancelled) setInsight(result);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, word, start, fullText]);

  if (!insight || insight.word !== word.toLowerCase()) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        AIが文脈を解析中...
      </div>
    );
  }

  return (
    <InsightCard
      badgeLabel={insight.badgeLabel}
      badgeClassName={
        insight.source === "ai"
          ? "bg-indigo-100 text-indigo-800"
          : insight.source === "generic"
            ? "bg-teal-100 text-teal-800"
            : "bg-neutral-100 text-neutral-500"
      }
      headword={insight.word}
      insight={insight.insight}
      suggestions={insight.suggestions}
      onPick={onPick}
      emptyMessage="この単語にはまだ言い換え候補がありません。"
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
}: {
  badgeLabel: string;
  badgeClassName: string;
  headword: string;
  insight: string;
  suggestions: Suggestion[];
  onPick: (replacement: string) => void;
  emptyMessage?: string;
}) {
  return (
    <div>
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
        emptyMessage && <p className="text-xs text-neutral-400">{emptyMessage}</p>
      )}
    </div>
  );
}
