"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ClipboardPaste, RotateCcw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  applyAiTypoFlags,
  applyPronounContextFlags,
  getExtendedContext,
  tokenize,
  type AiTypoInfo,
  type Token,
} from "@/lib/tokenize";
import { SAMPLE_TEXT, contextualPronouns } from "@/data/habit-rules";
import { loadDictionary } from "@/lib/spellcheck";
import { checkPronounContext, scanTextForContextualTypos } from "@/lib/word-insight";
import { buildIssueItems } from "@/lib/issue-list";
import { Button } from "@/components/ui/button";
import { WordToken } from "./word-token";
import { IssuePanel, type IssuePanelTab } from "./issue-panel";

// サイドパネルからのジャンプ後、対象単語のパルス演出をどれだけ表示し
// 続けるか。globals.css の .animate-issue-jump の総再生時間と揃える。
const JUMP_HIGHLIGHT_DURATION_MS = 1600;

const MIN_HEIGHT = 224;

// 入力中の単語（例: "policy" の途中の "polic"）を誤ってスペルミス判定
// しないよう、入力が止まってからこの時間が経過するまでスペルチェックの
// 反映を遅らせる。
const SPELLCHECK_DEBOUNCE_MS = 900;

// we/us/our の文脈チェックに一度に送る出現数の上限（コスト・応答時間の抑制）。
const MAX_PRONOUN_OCCURRENCES = 24;

// vagueStarts が未確定の間、毎レンダー新しい Set を作らないための共有インスタンス。
const EMPTY_STARTS: ReadonlySet<number> = new Set();

// 権限ダイアログが表示されない/応答が返らない環境で貼り付けボタンが
// 無反応に見えたままにならないよう、待機時間の上限を設ける。
const PASTE_TIMEOUT_MS = 8000;

// textarea とハイライト表示用オーバーレイの文字位置を完全に一致させるため、
// フォント・行間・字間・改行規則・パディング・ボーダー幅・box-sizing を
// 1文字たりとも変えずに両者へ適用する共有クラス。
// `block` は必須: <textarea> は既定で display:inline-block のため、
// 指定しないと行ボックスの余白（ベースライン揃えの隙間）分だけ
// 高さがオーバーレイ側とズレてしまう。
const SHARED_BOX_CLASSES =
  "block w-full rounded-2xl border-2 px-6 py-5 text-lg leading-8 tracking-normal font-sans whitespace-pre-wrap break-words [word-break:normal] [box-sizing:border-box]";

export function TextEditor() {
  const [text, setText] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dictionary, setDictionary] = useState<Set<string> | null>(null);
  const [debouncedText, setDebouncedText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [isPasting, setIsPasting] = useState(false);
  const [aiTypos, setAiTypos] = useState<Map<string, AiTypoInfo>>(new Map());
  // we/us/our のうち、AIが「曖昧な一般論の主語」と確認した出現箇所（トークンの
  // start 位置）の集合。position は特定のテキストの状態でのみ意味を持つため、
  // どのテキストに対する結果かを text と一緒に保持し、一致する場合のみ使う。
  const [vaguePronouns, setVaguePronouns] = useState<{ text: string; starts: Set<number> }>({
    text: "",
    starts: new Set(),
  });
  // サイドパネルの開閉状態。null は閉じている状態を表し、下部の
  // ステータスボタンを押したタイミングで対応するタブが開く。
  const [activePanel, setActivePanel] = useState<IssuePanelTab | null>(null);
  // サイドパネルの一覧からジャンプしてきた単語トークンの start 位置。
  // 一致するトークンだけ一時的にパルス演出（.animate-issue-jump）を付与する。
  const [jumpTargetId, setJumpTargetId] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const jumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDictionary().then((dict) => {
      if (!cancelled) setDictionary(dict);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedText(text), SPELLCHECK_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [text]);

  // 入力が確定した（＝一定時間止まった）タイミングで、文章全体に対して
  // 文脈的なタイポ（例: leaned → learned）の事前スキャンを行う。
  // タップする前から赤ハイライトを付けられるようにするための処理。
  useEffect(() => {
    if (!debouncedText || debouncedText !== text) return;
    let cancelled = false;
    scanTextForContextualTypos(debouncedText).then((typos) => {
      if (cancelled || typos.length === 0) return;
      setAiTypos((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const typo of typos) {
          const key = typo.word.toLowerCase();
          if (!next.has(key)) {
            next.set(key, {
              suggestedSpelling: typo.suggestedSpelling,
              explanation: typo.explanation,
            });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedText, text]);

  // クリック時にAI（/api/word-insight）が isTypo: true と判定した単語も、
  // 以後は文章全体でリアルタイムに赤ハイライトへ反映されるようにする。
  const handleConfirmAiTypo = useCallback(
    (word: string, suggestedSpelling: string, explanation: string) => {
      const key = word.toLowerCase();
      setAiTypos((prev) => {
        if (prev.has(key)) return prev;
        const next = new Map(prev);
        next.set(key, { suggestedSpelling, explanation });
        return next;
      });
    },
    [],
  );

  // 入力が確定した（＝一定時間止まった）タイミングで、文章中の we/us/our の
  // 各出現箇所についてAIに文脈判定させる（具体的な人物を指しているか、
  // 曖昧な一般論の主語かどうか）。タップ前から黄色ハイライトを付けるための処理。
  useEffect(() => {
    if (!debouncedText || debouncedText !== text) return;
    let cancelled = false;

    const pronounTokens = tokenize(debouncedText).filter(
      (token): token is Extract<Token, { type: "word" }> =>
        token.type === "word" && contextualPronouns.has(token.text.toLowerCase()),
    );

    const occurrences = pronounTokens.slice(0, MAX_PRONOUN_OCCURRENCES).map((token) => ({
      id: token.start,
      word: token.text,
      // 先行詞（例: 前文で紹介された人物名）が前文にあるケースにも
      // 対応できるよう、直前の1文も含めた文脈をAIに渡す。
      sentence: getExtendedContext(debouncedText, token.start, 1),
    }));

    // occurrences が空の場合も checkPronounContext は（通信を行わず）即座に
    // 空集合を返すため、setState は常に then() の中でのみ行われる。
    // documentText（文章全体）を渡すことで、個人的な体験談かアカデミックな
    // 論説文かのトーン判定も行われる。
    checkPronounContext(occurrences, debouncedText).then((vagueIds) => {
      if (cancelled) return;
      setVaguePronouns({ text: debouncedText, starts: vagueIds });
    });

    return () => {
      cancelled = true;
    };
  }, [debouncedText, text]);

  // クリック時にAI（/api/word-insight）が「曖昧な一般論の主語」と判定した
  // we/us/our も、以後はリアルタイムに黄色ハイライトへ反映されるようにする。
  const handleConfirmVaguePronoun = useCallback((position: number, forText: string) => {
    setVaguePronouns((prev) => {
      if (prev.text === forText) {
        if (prev.starts.has(position)) return prev;
        const next = new Set(prev.starts);
        next.add(position);
        return { text: forText, starts: next };
      }
      return { text: forText, starts: new Set([position]) };
    });
  }, []);

  // 入力が確定した（＝一定時間止まった）場合のみ辞書チェックを適用する。
  // まだ確定していない間は dictionary を渡さず、赤色ハイライトの更新を保留する。
  const spellcheckDictionary = debouncedText === text ? dictionary : null;
  const vagueStarts = vaguePronouns.text === text ? vaguePronouns.starts : EMPTY_STARTS;
  const tokens = useMemo(() => {
    const base = tokenize(text, spellcheckDictionary);
    const withTypos = applyAiTypoFlags(base, aiTypos);
    return applyPronounContextFlags(withTypos, vagueStarts);
  }, [text, spellcheckDictionary, aiTypos, vagueStarts]);
  const { improvements: improvementItems, spelling: spellingItems } = useMemo(
    () => buildIssueItems(tokens),
    [tokens],
  );
  const highlightCount = improvementItems.length;
  const typoCount = spellingItems.length;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function adjustHeight() {
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, MIN_HEIGHT)}px`;
    }

    adjustHeight();

    // 折り返し幅が変わる（＝ウィンドウ幅の変化など）と行数が変わり、
    // テキストエリアとオーバーレイの高さがズレるため、幅の変化にも追従させる。
    const resizeObserver = new ResizeObserver(adjustHeight);
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [text]);

  function handleReplace(start: number, end: number, replacement: string) {
    setText((prev) => prev.slice(0, start) + replacement + prev.slice(end));
    setActiveKey(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSample() {
    setText(SAMPLE_TEXT);
    setActiveKey(null);
  }

  async function handlePaste() {
    setPasteError(null);

    if (!navigator.clipboard?.readText) {
      setPasteError(
        "お使いのブラウザはボタンからの貼り付けに対応していません。Ctrl+V（Macは⌘+V）で貼り付けてください。",
      );
      return;
    }

    setIsPasting(true);
    try {
      // 権限ダイアログが表示されないまま応答が返らないブラウザ環境も
      // あるため、一定時間で諦めてフォールバック表示に切り替える。
      const clipboardText = await Promise.race([
        navigator.clipboard.readText(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("clipboard-read-timeout")), PASTE_TIMEOUT_MS),
        ),
      ]);
      if (!clipboardText) {
        setPasteError("クリップボードにテキストが見つかりませんでした。");
        return;
      }
      setText(clipboardText);
      setActiveKey(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      console.error("Failed to read clipboard:", error);
      setPasteError(
        "クリップボードの読み取りが許可されませんでした。Ctrl+V（Macは⌘+V）で貼り付けてください。",
      );
    } finally {
      setIsPasting(false);
    }
  }

  function handleClear() {
    setText("");
    setActiveKey(null);
    textareaRef.current?.focus();
  }

  // 下部のステータスボタン（改善ポイント／スペルミス）を押した時の開閉処理。
  // パネルが閉じている場合は該当タブで開き、既に同じタブが開いている場合は
  // 閉じる。別のタブが開いている場合はそのタブへ切り替える。
  function handleStatusButtonClick(panel: IssuePanelTab) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function handleClosePanel() {
    setActivePanel(null);
  }

  // サイドパネルの一覧項目をクリックした時、本文中の該当単語まで
  // スムーズスクロールし、一時的にパルス演出でハイライトする。
  const handleSelectIssue = useCallback((id: number) => {
    setJumpTargetId(id);
    document.getElementById(`token-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    if (jumpTimeoutRef.current) clearTimeout(jumpTimeoutRef.current);
    jumpTimeoutRef.current = setTimeout(() => {
      setJumpTargetId(null);
    }, JUMP_HIGHLIGHT_DURATION_MS);
  }, []);

  function renderWordToken(token: Extract<Token, { type: "word" }>) {
    return (
      <WordToken
        key={token.key}
        token={token}
        fullText={text}
        dictionary={dictionary}
        isOpen={activeKey === token.key}
        isJumpTarget={jumpTargetId === token.start}
        onOpenChange={(open) => setActiveKey(open ? token.key : null)}
        onReplace={handleReplace}
        onConfirmAiTypo={handleConfirmAiTypo}
        onConfirmVaguePronoun={handleConfirmVaguePronoun}
      />
    );
  }

  // 単語トークンの直後に「改行させたくない句読点」（attachedToPrevious）が
  // 続く場合、両者を1つの whitespace-nowrap な span でまとめて描画することで、
  // 句読点だけが行末で孤立して次行に落ちるのを防ぐ。
  function renderTokenNodes(): ReactNode[] {
    const nodes: ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === "word") {
        const next = tokens[i + 1];
        if (next && next.type === "text" && next.attachedToPrevious) {
          nodes.push(
            <span key={token.key} className="whitespace-nowrap">
              {renderWordToken(token)}
              {next.text}
            </span>,
          );
          i++;
          continue;
        }
        nodes.push(renderWordToken(token));
      } else {
        nodes.push(<span key={token.key}>{token.text}</span>);
      }
    }
    return nodes;
  }

  return (
    <div className="flex w-full flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
              黄色：言い換え推奨の癖のある単語
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              赤色：スペルミスの疑い
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={handleSample}>
              <Sparkles className="h-4 w-4" />
              サンプル文章をセット
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePaste}
              disabled={isPasting}
            >
              <ClipboardPaste className="h-4 w-4" />
              {isPasting ? "貼り付け中..." : "貼り付け"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleClear}>
              <RotateCcw className="h-4 w-4" />
              クリア
            </Button>
          </div>
        </div>

        {pasteError && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {pasteError}
          </p>
        )}

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActiveKey(null);
            }}
            placeholder="ここに英文を入力または貼り付けしてください..."
            spellCheck={false}
            className={cn(
              SHARED_BOX_CLASSES,
              "relative z-0 resize-none overflow-hidden border-neutral-200 bg-white text-transparent caret-neutral-900 shadow-sm outline-none placeholder:text-neutral-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-100",
            )}
          />
          <div
            className={cn(
              SHARED_BOX_CLASSES,
              "pointer-events-none absolute inset-0 z-10 border-transparent text-neutral-800",
            )}
          >
            {text.length > 0 && renderTokenNodes()}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-sm font-medium whitespace-nowrap text-neutral-600">
            {text.length} 文字
          </span>
          <span className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleStatusButtonClick("improvements")}
              aria-pressed={activePanel === "improvements"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                highlightCount > 0
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
                activePanel === "improvements" && "ring-2 ring-amber-400",
              )}
            >
              <span className="text-base font-bold">{highlightCount}</span>
              件の改善ポイント
            </button>
            <button
              type="button"
              onClick={() => handleStatusButtonClick("spelling")}
              aria-pressed={activePanel === "spelling"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                typoCount > 0
                  ? "bg-red-100 text-red-900 hover:bg-red-200"
                  : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200",
                activePanel === "spelling" && "ring-2 ring-red-400",
              )}
            >
              <span className="text-base font-bold">{typoCount}</span>
              件のスペルミスの疑い
            </button>
          </span>
        </div>
      </div>

      {activePanel && (
        <IssuePanel
          activeTab={activePanel}
          onTabChange={setActivePanel}
          onClose={handleClosePanel}
          improvementItems={improvementItems}
          spellingItems={spellingItems}
          onSelectIssue={handleSelectIssue}
        />
      )}
    </div>
  );
}
