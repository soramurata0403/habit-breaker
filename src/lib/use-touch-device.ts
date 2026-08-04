"use client";

import { useSyncExternalStore } from "react";

// マウスホバーが使えず、指などの粗いポインタで操作する端末
// （スマートフォン・タブレット）を判定するためのメディアクエリ。
// タッチ対応のノートPCのようにマウスも併用できる端末は false になり、
// 従来どおりのダブルクリック操作が保たれる。
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

function getMediaQueryList(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }
  return window.matchMedia(TOUCH_QUERY);
}

function subscribe(listener: () => void): () => void {
  const mediaQueryList = getMediaQueryList();
  if (!mediaQueryList) return () => {};

  // Safari 13 以前は addEventListener 非対応のため addListener にフォールバックする。
  if (typeof mediaQueryList.addEventListener === "function") {
    mediaQueryList.addEventListener("change", listener);
    return () => mediaQueryList.removeEventListener("change", listener);
  }
  mediaQueryList.addListener(listener);
  return () => mediaQueryList.removeListener(listener);
}

function getSnapshot(): boolean {
  return getMediaQueryList()?.matches ?? false;
}

// SSR時とハイドレーション時は false（＝デスクトップ想定）で描画し、
// 実際の判定はハイドレーション後の再レンダリングで反映する。
// これによりサーバー・クライアント間のHTML不一致が起きない。
function getServerSnapshot(): boolean {
  return false;
}

/**
 * タッチ操作が主となる端末かどうかを購読するフック。
 * ダブルタップではOS標準の選択メニューが割り込むため、この判定を使って
 * モバイルではシングルタップで言い換えを呼び出せるようにする。
 */
export function useIsTouchDevice(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
