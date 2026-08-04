"use client";

import { useEffect, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { getContextSentence, getExtendedContext, matchCase, type Token } from "@/lib/tokenize";
import { suggestCorrections } from "@/lib/spellcheck";
import { fetchWordInsight, requiresApiCall, type WordInsight } from "@/lib/word-insight";
import { contextualPronouns, type Suggestion } from "@/data/habit-rules";
import { DAILY_LIMIT_MESSAGE, MAX_TEXT_LENGTH } from "@/lib/config";

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
  // 口語表現の言い換え提案（style）はコーパスルールと同じ黄色扱いにする。
  const isHighlighted = Boolean(token.rule) || Boolean(token.isAiStyle);
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

  /**
   * 誤りの修正を適用する。句レベルの修正（例: "am believing" → "believe"）では
   * 単語1語ではなく句全体を置き換え、"am believe" のような文法崩壊を防ぐ。
   */
  function handleApplyCorrection(correction: string) {
    const start = token.aiReplaceStart ?? token.start;
    const end = token.aiReplaceEnd ?? token.end;
    const original = fullText.slice(start, end);
    onReplace(start, end, matchCase(original, correction));
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
            // タッチ端末で長押し・ダブルタップしたときに、OS標準の選択メニューや
            // ダブルタップズームが割り込んでポップオーバーの操作を妨げないようにする。
            "touch-manipulation select-none [-webkit-touch-callout:none]",
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
          {token.isAiStyle && token.aiCorrection ? (
            // 口語的な表現の言い換え提案（黄色）。理由と候補を1つ提示する。
            <CorrectionCard
              tone="style"
              word={token.text}
              correction={token.aiCorrection}
              explanation={token.aiExplanation ?? ""}
              isUsageExhausted={isUsageExhausted}
              onApply={handleApplyCorrection}
            />
          ) : token.rule ? (
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
              isUsageExhausted={isUsageExhausted}
            />
          ) : isTypoFlagged ? (
            // 赤色（ミスの疑い）は「警告バッジ・理由・修正するボタン」だけを出す。
            // 言い換え候補は取得しない（非同期に届いた候補が解説を上書きして
            // 消えてしまう問題を避けるため）。修正して通常の文になった後で、
            // 改めてダブルクリックすれば言い換えを探せる。
            <CorrectionCard
              word={token.text}
              correction={
                token.isAiTypo
                  ? token.aiCorrection
                  : dictionary
                    ? suggestCorrections(token.text, dictionary, 1)[0]
                    : undefined
              }
              explanation={
                token.aiExplanation ??
                `"${token.text}" は辞書に見つかりませんでした。スペルミスの可能性があります。`
              }
              isUsageExhausted={isUsageExhausted}
              onApply={handleApplyCorrection}
            />
          ) : (
            <DynamicInsight
              isOpen={isOpen}
              word={token.text}
              start={token.start}
              fullText={fullText}
              isUsageExhausted={isUsageExhausted}
              isOverLength={isOverLength}
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

/**
 * 赤色ハイライト（ミスの疑い）専用の表示。
 * 警告バッジ・日本語の理由・「修正する」ボタンの3点だけを出し、
 * 言い換え候補の取得は行わない。
 */
function CorrectionCard({
  word,
  correction,
  explanation,
  isUsageExhausted,
  onApply,
  tone = "error",
}: {
  word: string;
  correction?: string;
  explanation: string;
  isUsageExhausted: boolean;
  onApply: (correction: string) => void;
  /** error = ミスの疑い（赤）／ style = アカデミックな表現への言い換え（黄） */
  tone?: "error" | "style";
}) {
  const isStyle = tone === "style";
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
            isStyle ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800",
          )}
        >
          {isStyle ? <Sparkles className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
          {isStyle ? "アカデミックな表現へ" : "ミスの疑い"}
        </span>
        <span className="font-mono text-sm font-semibold text-neutral-900">{word}</span>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-neutral-600">{explanation}</p>

      {correction ? (
        isUsageExhausted ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {DAILY_LIMIT_MESSAGE}
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onApply(correction)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
              isStyle
                ? "border-amber-300 bg-amber-50 hover:border-amber-400 hover:bg-amber-100"
                : "border-red-300 bg-red-50 hover:border-red-400 hover:bg-red-100",
            )}
          >
            <span
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                isStyle ? "text-amber-900" : "text-red-800",
              )}
            >
              <ArrowRight className="h-4 w-4 shrink-0" />
              {correction}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-white",
                isStyle ? "bg-amber-600" : "bg-red-600",
              )}
            >
              {isStyle ? "置き換える" : "修正する"}
            </span>
          </button>
        )
      ) : (
        <p className="text-xs text-neutral-400">近い綴りの候補が見つかりませんでした。</p>
      )}
    </div>
  );
}

function DynamicInsight({
  isOpen,
  word,
  start,
  fullText,
  isUsageExhausted,
  isOverLength,
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
  onPick: (replacement: string) => void;
  onConfirmAiTypo: (word: string, correction: string, explanation: string) => void;
  onConfirmVaguePronoun: (position: number, forText: string) => void;
}) {
  const [insight, setInsight] = useState<WordInsight | null>(null);

  // コーパスルールに載っている単語や、品詞が確定していて言い換えの
  // 対象にならない多義語（"as well as" 等）は通信不要で即座に返せる。
  const needsApi = requiresApiCall(word, fullText, start);
  // 閲覧自体は利用回数を消費しないため、上限到達でも解説は表示できる。
  // 文字数超過のときだけ通信を止める。
  const isBlocked = needsApi && isOverLength;

  useEffect(() => {
    if (!isOpen || isBlocked) return;
    let cancelled = false;
    // we/us/our は先行詞（例: 前文で紹介された人物名）が前文にあることが
    // 多いため、直前の1文も含めた文脈をAIに渡す。それ以外は現在の文のみ。
    const contextSentence = contextualPronouns.has(word.toLowerCase())
      ? getExtendedContext(fullText, start, 1)
      : getContextSentence(fullText, start);
    // start を渡すと、多義語（so / like / well / as）の品詞をその位置の
    // 文脈から判定し、品詞に一致する候補だけを出せるようになる。
    fetchWordInsight(word, contextSentence, fullText, start).then((result) => {
      if (cancelled) return;
      setInsight(result);

      // クリックして初めてAIが誤りだと判定した単語は、以後は文章全体で
      // リアルタイムに赤ハイライト・件数へ反映されるようにする。
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
    word,
    start,
    fullText,
    onConfirmAiTypo,
    onConfirmVaguePronoun,
  ]);

  const resolved = insight && insight.word === word.toLowerCase() ? insight : null;

  if (isBlocked && !resolved) {
    return (
      <div className="py-2">
        <p className="text-sm leading-relaxed text-neutral-600">
          解析できるのは{MAX_TEXT_LENGTH}文字までです。文字数を減らすと解説を表示できます。
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
        resolved.source === "ai"
          ? "bg-indigo-100 text-indigo-800"
          : resolved.source === "generic"
            ? "bg-teal-100 text-teal-800"
            : resolved.source === "sense"
              ? "bg-sky-100 text-sky-800"
              : "bg-neutral-100 text-neutral-500"
      }
      headword={resolved.word}
      insight={resolved.insight}
      suggestions={resolved.suggestions}
      onPick={onPick}
      isUsageExhausted={isUsageExhausted}
      emptyMessage={
        // we/us/our が「具体的な人物を指す適切な用法」と確認された場合や、
        // 多義語の用法を説明している場合は、解説文自体がその旨を述べているため
        // 汎用の空メッセージは表示しない。
        resolved.isVaguePronoun === false || resolved.source === "sense"
          ? undefined
          : "この単語にはまだ言い換え候補がありません。"
      }
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
  isUsageExhausted,
}: {
  badgeLabel: string;
  badgeClassName: string;
  headword: string;
  insight: string;
  suggestions: Suggestion[];
  onPick: (replacement: string) => void;
  emptyMessage?: string;
  isUsageExhausted?: boolean;
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
          {isUsageExhausted ? (
            // 閲覧は自由だが、本文への適用は利用回数を消費するため上限後は行えない。
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {DAILY_LIMIT_MESSAGE}
            </p>
          ) : (
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
          )}
        </>
      ) : (
        emptyMessage && <p className="text-xs text-neutral-400">{emptyMessage}</p>
      )}
    </div>
  );
}
