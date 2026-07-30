"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { tokenize } from "@/lib/tokenize";
import { SAMPLE_TEXT } from "@/data/habit-rules";
import { loadDictionary } from "@/lib/spellcheck";
import { Button } from "@/components/ui/button";
import { WordToken } from "./word-token";

const MIN_HEIGHT = 224;

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadDictionary().then((dict) => {
      if (!cancelled) setDictionary(dict);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tokens = useMemo(() => tokenize(text, dictionary), [text, dictionary]);
  const highlightCount = useMemo(
    () => tokens.filter((token) => token.type === "word" && token.rule).length,
    [tokens],
  );
  const typoCount = useMemo(
    () => tokens.filter((token) => token.type === "word" && token.isUnknownWord).length,
    [tokens],
  );

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

  function handleClear() {
    setText("");
    setActiveKey(null);
    textareaRef.current?.focus();
  }

  return (
    <div className="w-full">
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
          <Button type="button" size="sm" variant="outline" onClick={handleClear}>
            <RotateCcw className="h-4 w-4" />
            クリア
          </Button>
        </div>
      </div>

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
          {text.length > 0 &&
            tokens.map((token) =>
              token.type === "word" ? (
                <WordToken
                  key={token.key}
                  token={token}
                  fullText={text}
                  dictionary={dictionary}
                  isOpen={activeKey === token.key}
                  onOpenChange={(open) => setActiveKey(open ? token.key : null)}
                  onReplace={handleReplace}
                />
              ) : (
                <span key={token.key}>{token.text}</span>
              ),
            )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-neutral-400">
        <span className="whitespace-nowrap">{text.length} 文字</span>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <span className="whitespace-nowrap">{highlightCount} 件の改善ポイント</span>
          <span className="whitespace-nowrap">{typoCount} 件のスペルミスの疑い</span>
        </span>
      </div>
    </div>
  );
}
