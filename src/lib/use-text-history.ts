"use client";

import { useCallback, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";

/**
 * textarea の内容を React の state で管理しつつ、プログラム的な書き換え
 * （言い換え候補の適用・貼り付け・クリア等）も含めて Undo / Redo を
 * 正しく動かすための履歴スタック。
 *
 * ブラウザ標準の Undo 履歴は、value を state 経由で書き換えると実際の
 * 編集列と食い違ってしまい、まったく別の時点のテキストが復元されるなど
 * 壊れた挙動になる。そのため履歴は自前で保持し、Undo/Redo のキー操作は
 * preventDefault して標準履歴を使わせない。
 */

/** この時間内に連続した入力は1つの履歴エントリにまとめる（1文字ずつ戻らないように）。 */
const COALESCE_MS = 500;

/** 履歴の保持上限（古いものから捨てる）。 */
const MAX_HISTORY_ENTRIES = 200;

type HistoryEntry = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

type HistoryState = {
  /** entries[index] が常に「現在の内容」を表す。 */
  entries: HistoryEntry[];
  index: number;
  lastEditAt: number;
  /** 直前の記録がキーボード入力だったか（まとめる対象かどうかの判定に使う）。 */
  lastWasTyping: boolean;
};

type Options = {
  initialValue: string;
  setValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** Undo/Redo で内容が入れ替わった直後に呼ばれる（開いているポップオーバーを閉じる等）。 */
  onRestore?: () => void;
};

export function useTextHistory({ initialValue, setValue, textareaRef, onRestore }: Options) {
  const historyRef = useRef<HistoryState>({
    entries: [
      {
        text: initialValue,
        selectionStart: initialValue.length,
        selectionEnd: initialValue.length,
      },
    ],
    index: 0,
    lastEditAt: 0,
    lastWasTyping: false,
  });

  // 復元・置換の直後にキャレット位置を戻すための予約。
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);

  // 予約があるときだけ DOM の選択範囲を適用する（state 更新は行わない）。
  useLayoutEffect(() => {
    const pending = pendingSelectionRef.current;
    if (!pending) return;
    pendingSelectionRef.current = null;

    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    const max = element.value.length;
    element.setSelectionRange(Math.min(pending.start, max), Math.min(pending.end, max));
  });

  const record = useCallback((entry: HistoryEntry, coalesce: boolean) => {
    const history = historyRef.current;
    const now = Date.now();

    // Undo 後に新しく編集した場合、それより先（Redo 側）の履歴は破棄する。
    if (history.index < history.entries.length - 1) {
      history.entries = history.entries.slice(0, history.index + 1);
    }

    const canCoalesce =
      coalesce &&
      history.lastWasTyping &&
      history.index > 0 &&
      now - history.lastEditAt < COALESCE_MS;

    if (canCoalesce) {
      // 直近の入力の続きとみなし、現在のエントリを上書きする。
      history.entries[history.index] = entry;
    } else {
      history.entries.push(entry);
      if (history.entries.length > MAX_HISTORY_ENTRIES) history.entries.shift();
      history.index = history.entries.length - 1;
    }

    history.lastEditAt = now;
    history.lastWasTyping = coalesce;
  }, []);

  /** キーボード入力による変更。短時間の連続入力は1エントリにまとめる。 */
  const recordTyping = useCallback(
    (text: string, selectionStart: number, selectionEnd: number) => {
      record({ text, selectionStart, selectionEnd }, true);
    },
    [record],
  );

  /**
   * 言い換え候補の適用・貼り付け・クリア・サンプル投入など、
   * ひとまとまりの操作による変更。常に独立した履歴エントリにする。
   */
  const recordCommit = useCallback(
    (text: string, selectionStart: number, selectionEnd: number) => {
      record({ text, selectionStart, selectionEnd }, false);
    },
    [record],
  );

  const restore = useCallback(
    (entry: HistoryEntry) => {
      historyRef.current.lastWasTyping = false;
      pendingSelectionRef.current = {
        start: entry.selectionStart,
        end: entry.selectionEnd,
      };
      setValue(entry.text);
      onRestore?.();
    },
    [setValue, onRestore],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.index <= 0) return;
    history.index -= 1;
    restore(history.entries[history.index]);
  }, [restore]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.index >= history.entries.length - 1) return;
    history.index += 1;
    restore(history.entries[history.index]);
  }, [restore]);

  /** キャレット位置だけを次のレンダリング後に指定する（置換直後など）。 */
  const setCaret = useCallback((start: number, end: number = start) => {
    pendingSelectionRef.current = { start, end };
  }, []);

  /**
   * Undo: Ctrl+Z / Cmd+Z
   * Redo: Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y
   */
  const handleUndoRedoKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    },
    [undo, redo],
  );

  return { recordTyping, recordCommit, undo, redo, setCaret, handleUndoRedoKeyDown };
}
