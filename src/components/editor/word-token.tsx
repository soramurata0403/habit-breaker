"use client";

import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { getContextSentence, getExtendedContext, matchCase, type Token } from "@/lib/tokenize";
import { suggestCorrections } from "@/lib/spellcheck";
import { fetchWordInsight, requiresApiCall, type WordInsight } from "@/lib/word-insight";
import { contextualPronouns, type Suggestion } from "@/data/habit-rules";
import { DAILY_LIMIT_MESSAGE, MAX_TEXT_LENGTH } from "@/lib/config";
import { consumeRequest } from "@/lib/usage-store";

type WordTokenProps = {
  token: Extract<Token, { type: "word" }>;
  fullText: string;
  dictionary: Set<string> | null;
  isOpen: boolean;
  isJumpTarget?: boolean;
  isUsageExhausted?: boolean;
  isOverLength?: boolean;
  /** 指摘のない単語について、ユーザーが明示的に言い換え検索を要求した場合に true。 */
  isParaphraseRequested?: boolean;
  onOpenChange: (open: boolean) => void;
  onReplace: (start: number, end: number, replacement: string) => void;
  onConfirmAiTypo: (word: string, suggestedSpelling: string, explanation: string) => void;
  onConfirmVaguePronoun: (position: number, forText: string) => void;
};

export function WordToken({
  token,
  fullText,
  dictionary,
  isOpen,
  isJumpTarget = false,
  isUsageExhausted = false,
  isOverLength = false,
  isParaphraseRequested = false,
  onOpenChange,
  onReplace,
  onConfirmAiTypo,
  onConfirmVaguePronoun,
}: WordTokenProps) {
  const isHighlighted = Boolean(token.rule);
  const isTypoFlagged = Boolean(token.isUnknownWord) || Boolean(token.isAiTypo);

  // ハイライト対象（黄色・赤色）の単語と、ユーザーが「言い換えを探す」を
  // 明示的に押した単語だけをクリック可能にする。
  // 指摘のない単語までボタンにしていると、本文中をクリックして
  // カーソルを移動しただけでポップオーバーが開き、解説APIが呼ばれて
  // 利用回数が減ってしまう。素のテキストとして描画しておけば、
  // オーバーレイは pointer-events: none なのでクリックはそのまま
  // 下の textarea に届き、通常どおりカーソル移動になる。
  // id は残しておき、言い換えツールチップの表示位置の基準として使う。
  if (!isHighlighted && !isTypoFlagged && !isParaphraseRequested) {
    return <span id={`token-${token.start}`}>{token.text}</span>;
  }

  function handlePick(replacement: string) {
    onReplace(token.start, token.end, matchCase(token.text, replacement));
  }

  // 他のハイライト単語やサイドパネルの一覧項目をクリックした場合は、
  // Radix 既定の「外側クリックで閉じる」処理を抑止する。
  // 抑止しないと pointerdown で先にこのポップオーバーが閉じられ、
  // 続く click での切り替えと競合して「1回目は閉じるだけ」になってしまう。
  // 抑止した場合でも、切り替え先が activeKey を書き換えることで
  // このポップオーバーは自動的に閉じるため、開きっぱなしにはならない。
  function handleInteractOutside(event: { detail: { originalEvent: Event }; preventDefault: () => void }) {
    const target = event.detail.originalEvent.target;
    if (target instanceof Element && target.closest("[data-word-token], [data-issue-row]")) {
      event.preventDefault();
    }
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={`token-${token.start}`}
          // 開いているポップオーバーの「外側クリック」判定から除外するための目印。
          // これが無いと、別のハイライト単語を押した時に「閉じる」だけが先に
          // 走ってしまい、切り替えに2クリック必要になる。
          data-word-token=""
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
            // サイドパネルの一覧からジャンプしてきた直後、対象の単語を
            // 一時的に光らせて視線を誘導する（点滅アニメーション）。
            isJumpTarget && "animate-issue-jump",
          )}
        >
          {token.text}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          // 選択中の単語と重ならないよう、単語の直下に12pxの余白を空けて配置する。
          sideOffset={12}
          // 画面端に近い単語では自動的に上下を反転（フリップ）させ、
          // ポップオーバーが画面外にはみ出さないようにする。
          avoidCollisions
          collisionPadding={16}
          onInteractOutside={handleInteractOutside}
          className="animate-popover z-50 w-[21rem] rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-xl focus:outline-none"
        >
          {token.rule ? (
            <InsightCard
              badgeLabel="オーバーユース単語"
              badgeClassName="bg-amber-100 text-amber-800"
              headword={token.rule.word}
              insight={
                token.occurrenceCount
                  ? `"${token.rule.word}" がこの文章内で${token.occurrenceCount}回使われています。語彙のバリエーションを増やすために、以下の言い換えを検討してみましょう。`
                  : token.rule.insight
              }
              suggestions={token.rule.suggestions}
              onPick={handlePick}
            />
          ) : (
            <DynamicInsight
              isOpen={isOpen}
              word={token.text}
              start={token.start}
              fullText={fullText}
              isUsageExhausted={isUsageExhausted}
              isOverLength={isOverLength}
              isTypoFlagged={isTypoFlagged}
              isAiTypo={Boolean(token.isAiTypo)}
              aiSuggestedSpelling={token.aiSuggestedSpelling}
              aiExplanation={token.aiExplanation}
              dictionary={dictionary}
              onPick={handlePick}
              onConfirmAiTypo={onConfirmAiTypo}
              onConfirmVaguePronoun={onConfirmVaguePronoun}
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
  isUsageExhausted,
  isOverLength,
  isTypoFlagged,
  isAiTypo,
  aiSuggestedSpelling,
  aiExplanation,
  dictionary,
  onPick,
  onConfirmAiTypo,
  onConfirmVaguePronoun,
}: {
  isOpen: boolean;
  word: string;
  start: number;
  fullText: string;
  isUsageExhausted: boolean;
  isOverLength: boolean;
  isTypoFlagged: boolean;
  isAiTypo: boolean;
  aiSuggestedSpelling?: string;
  aiExplanation?: string;
  dictionary: Set<string> | null;
  onPick: (replacement: string) => void;
  onConfirmAiTypo: (word: string, suggestedSpelling: string, explanation: string) => void;
  onConfirmVaguePronoun: (position: number, forText: string) => void;
}) {
  const [insight, setInsight] = useState<WordInsight | null>(null);

  // 事前スキャン・過去のクリックでAIが文脈的な誤りだと確認済みの場合は、
  // それを最優先の即時表示として使う（辞書に無い語の編集距離ベースの
  // 推測よりも、実際にAIが確認した候補の方が信頼できるため）。
  // それ以外で辞書に無い語（isUnknownWord）の場合は、編集距離ベースの
  // 候補をAIの応答を待たずに即座に表示する（リアルタイム性を優先）。
  const instantFallback = useMemo(() => {
    if (isAiTypo && aiSuggestedSpelling) {
      return {
        word: word.toLowerCase(),
        source: "ai" as const,
        badgeLabel: "解説",
        insight:
          aiExplanation ?? `"${word}" は文脈上、誤字である可能性が高いと判断されました。`,
        suggestions: [],
        isTypo: true,
        suggestedSpelling: aiSuggestedSpelling,
      } satisfies WordInsight;
    }
    if (isTypoFlagged && dictionary) {
      return buildLocalTypoInsight(word, dictionary);
    }
    return null;
  }, [isAiTypo, aiSuggestedSpelling, aiExplanation, isTypoFlagged, dictionary, word]);

  // 既にタイポ確定済み（instantFallback.isTypo）の場合に、後から届く
  // /api/word-insight の応答だけを信頼してその判定を破棄・上書きしない
  // ようにするための値。LLMの応答は同じ単語・文脈でも毎回完全に同じとは
  // 限らず、後続の呼び出しが「タイポではない」と揺れて返ることがある。
  const confirmedSuggestedSpelling = instantFallback?.isTypo
    ? instantFallback.suggestedSpelling
    : undefined;

  // コーパスルールに載っている単語は通信不要で即座に返せるため、
  // 利用回数の上限や文字数超過の影響を受けない。
  const needsApi = requiresApiCall(word);
  const isBlocked = needsApi && (isUsageExhausted || isOverLength);

  useEffect(() => {
    if (!isOpen || isBlocked) return;
    let cancelled = false;
    // we/us/our は先行詞（例: 前文で紹介された人物名）が前文にあることが
    // 多いため、直前の1文も含めた文脈をAIに渡す。それ以外は現在の文のみ。
    const contextSentence = contextualPronouns.has(word.toLowerCase())
      ? getExtendedContext(fullText, start, 1)
      : getContextSentence(fullText, start);
    fetchWordInsight(word, contextSentence, fullText).then((result) => {
      // source が "ai" のときだけ、実際にAPIへ問い合わせて正常な応答を
      // 受け取っている（コーパス由来・ローカルフォールバックは消費しない）。
      if (result.source === "ai") consumeRequest();
      if (cancelled) return;
      // 赤色判定済みの単語で、AI側が「データなし」しか返せなかった場合は、
      // クライアント側の修正候補（instantFallback）の方が有用なので上書きしない。
      if (isTypoFlagged && result.source === "unknown") return;

      // 既にタイポと確定済みなのに、今回の応答がそれを否定した場合は、
      // 解説・言い換え候補は新しい内容を採用しつつ、タイポの警告バナーは
      // 維持する（結合）。ユーザーが修正するか閉じるまで消さないため。
      const shouldPreserveConfirmedTypo =
        Boolean(confirmedSuggestedSpelling) && !result.isTypo;

      setInsight(
        shouldPreserveConfirmedTypo
          ? { ...result, isTypo: true, suggestedSpelling: confirmedSuggestedSpelling }
          : result,
      );

      // クリックして初めてAIが isTypo: true と判定した単語も、以後は
      // 文章全体でリアルタイムに赤ハイライト・件数へ反映されるようにする。
      if (result.isTypo && result.suggestedSpelling) {
        onConfirmAiTypo(word, result.suggestedSpelling, result.insight);
      }
      // we/us/our について、クリックして初めてAIが「曖昧な一般論の主語」と
      // 判定した場合も、以後は文章全体でリアルタイムに黄色ハイライトへ
      // 反映されるようにする（具体的な人物を指すと判定された場合は何もしない）。
      if (result.isVaguePronoun === true) {
        onConfirmVaguePronoun(start, fullText);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    isBlocked,
    needsApi,
    word,
    start,
    fullText,
    isTypoFlagged,
    onConfirmAiTypo,
    onConfirmVaguePronoun,
    confirmedSuggestedSpelling,
  ]);

  const resolved =
    insight && insight.word === word.toLowerCase() ? insight : instantFallback;

  // 上限到達・文字数超過で通信できず、ローカルの候補も無い場合は理由を表示する。
  if (isBlocked && !resolved) {
    return (
      <div className="py-2">
        <p className="text-sm leading-relaxed text-neutral-600">
          {isOverLength
            ? `解析できるのは${MAX_TEXT_LENGTH}文字までです。文字数を減らすと解説を表示できます。`
            : DAILY_LIMIT_MESSAGE}
        </p>
      </div>
    );
  }

  if (!resolved) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-neutral-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        文脈を解析中...
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
      emptyMessage={
        // we/us/our が「具体的な人物を指す適切な用法」と確認された場合は、
        // 解説文自体がその旨を説明しているため、汎用の空メッセージは表示しない。
        resolved.isVaguePronoun === false
          ? undefined
          : "この単語にはまだ言い換え候補がありません。"
      }
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
