"use client";

import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { matchCase, type Token } from "@/lib/tokenize";

type WordTokenProps = {
  token: Extract<Token, { type: "word" }>;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (start: number, end: number, replacement: string) => void;
};

export function WordToken({ token, isOpen, onOpenChange, onReplace }: WordTokenProps) {
  const { rule } = token;

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "pointer-events-auto rounded px-0.5 underline decoration-amber-500 decoration-2 decoration-dotted underline-offset-4 transition-colors",
            "bg-amber-100/80 hover:bg-amber-200/80",
            isOpen && "bg-amber-200 ring-2 ring-amber-400",
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
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
              <Sparkles className="h-3 w-3" />
              オーバーユース単語
            </span>
            <span className="font-mono text-sm font-semibold text-neutral-900">
              {rule.word}
            </span>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-neutral-600">
            {rule.insight}
          </p>

          <p className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
            言い換え候補
          </p>
          <div className="space-y-1.5">
            {rule.suggestions.map((suggestion) => (
              <button
                key={suggestion.word}
                type="button"
                onClick={() =>
                  onReplace(
                    token.start,
                    token.end,
                    matchCase(token.text, suggestion.word),
                  )
                }
                className="group flex w-full items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-left transition-colors hover:border-teal-400 hover:bg-teal-50"
              >
                <span className="flex items-center gap-1.5">
                  <ArrowRight className="h-3.5 w-3.5 text-neutral-300 transition-colors group-hover:text-teal-500" />
                  <span className="font-medium text-neutral-900">
                    {suggestion.word}
                  </span>
                </span>
                <span className="text-xs text-neutral-500">
                  {suggestion.nuance}
                </span>
              </button>
            ))}
          </div>

          <Popover.Arrow className="fill-white" width={14} height={7} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
