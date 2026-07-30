"use client";

import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { IssueItem } from "@/lib/issue-list";

export type IssuePanelTab = "improvements" | "spelling";

type IssuePanelProps = {
  activeTab: IssuePanelTab;
  onTabChange: (tab: IssuePanelTab) => void;
  onClose: () => void;
  improvementItems: IssueItem[];
  spellingItems: IssueItem[];
  onSelectIssue: (id: number, tokenKey: string) => void;
};

export function IssuePanel({
  activeTab,
  onTabChange,
  onClose,
  improvementItems,
  spellingItems,
  onSelectIssue,
}: IssuePanelProps) {
  const items = activeTab === "improvements" ? improvementItems : spellingItems;

  return (
    // 幅・配置は親のラッパーが制御する（画面幅によって浮かせるか下に積むかが変わる）。
    // relative は閉じるボタンを枠の外側へ出すための基準。
    <aside className="animate-panel-in relative w-full rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {/* 閉じるボタンはパネルの白い枠と重ならないよう、負のオフセットで
          枠の外側（右上）へ出す。枠から約12px外側に浮かぶ。 */}
      <button
        type="button"
        onClick={onClose}
        aria-label="パネルを閉じる"
        className="absolute -top-3 -right-3 z-20 rounded-full border border-neutral-200 bg-white p-1.5 text-neutral-400 shadow-md transition-colors hover:bg-neutral-50 hover:text-neutral-600"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-center border-b border-neutral-100 px-3 py-3">
        <div className="flex gap-1 rounded-full bg-neutral-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => onTabChange("improvements")}
            className={cn(
              "rounded-full px-3 py-1.5 whitespace-nowrap transition-colors",
              activeTab === "improvements"
                ? "bg-amber-100 text-amber-900"
                : "text-neutral-500 hover:text-neutral-700",
            )}
          >
            改善ポイント（{improvementItems.length}）
          </button>
          <button
            type="button"
            onClick={() => onTabChange("spelling")}
            className={cn(
              "rounded-full px-3 py-1.5 whitespace-nowrap transition-colors",
              activeTab === "spelling"
                ? "bg-red-100 text-red-900"
                : "text-neutral-500 hover:text-neutral-700",
            )}
          >
            スペルミス（{spellingItems.length}）
          </button>
        </div>
      </div>

      <div className="max-h-[28rem] overflow-y-auto p-3">
        {items.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-neutral-400">
            {activeTab === "improvements"
              ? "改善ポイントは見つかりませんでした。"
              : "スペルミスの疑いは見つかりませんでした。"}
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelectIssue(item.id, item.tokenKey)}
                  className="w-full rounded-xl border border-neutral-200 px-3 py-2.5 text-left transition-colors hover:border-teal-300 hover:bg-teal-50"
                >
                  <span
                    className={cn(
                      "font-mono text-sm font-semibold",
                      activeTab === "improvements" ? "text-amber-800" : "text-red-800",
                    )}
                  >
                    {item.word}
                  </span>
                  <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
                    {item.detail}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
