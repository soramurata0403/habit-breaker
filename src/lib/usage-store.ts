"use client";

import { useSyncExternalStore } from "react";

import { MAX_DAILY_REQUESTS } from "@/lib/config";

const STORAGE_KEY = "habit-breaker:daily-usage";

export type UsageRecord = {
  /** YYYY-MM-DD（ローカル日付）。日付が変わるとカウントはリセットされる。 */
  date: string;
  count: number;
};

function todayKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function readFromStorage(): UsageRecord {
  const fresh: UsageRecord = { date: todayKey(), count: 0 };
  if (typeof window === "undefined") return fresh;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fresh;
    const record = parsed as Record<string, unknown>;
    if (typeof record.date !== "string" || typeof record.count !== "number") return fresh;
    // 日付が変わっていれば当日分は0から数え直す。
    if (record.date !== fresh.date) return fresh;
    return { date: record.date, count: Math.max(0, record.count) };
  } catch {
    // JSON破損・localStorage無効（プライベートモード等）。制限は当該セッション
    // のインメモリ値のみで動作させ、機能自体は止めない。
    return fresh;
  }
}

function writeToStorage(record: UsageRecord): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 保存できない環境でも、メモリ上のカウントだけで動作を継続する。
  }
}

// useSyncExternalStore の getSnapshot は「変化していない限り同一参照」を返す
// 必要があるため、値をキャッシュして保持する。
let cached: UsageRecord | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getUsageSnapshot(): UsageRecord {
  if (cached === null) {
    cached = readFromStorage();
  } else if (cached.date !== todayKey()) {
    // 日付をまたいだセッションでもリセットされるようにする。
    cached = { date: todayKey(), count: 0 };
  }
  return cached;
}

// SSR時とハイドレーション時に使う固定値。実際の残数はハイドレーション後の
// 再レンダリングで反映されるため、サーバー・クライアント間の不一致が起きない。
const SERVER_SNAPSHOT: UsageRecord = { date: "", count: 0 };

function getServerSnapshot(): UsageRecord {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // 別タブで消費された分も反映されるようにする。
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cached = readFromStorage();
    emit();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** 解析・生成リクエストを1回分消費して記録する。 */
export function consumeRequest(): void {
  const current = getUsageSnapshot();
  cached = { date: current.date, count: current.count + 1 };
  writeToStorage(cached);
  emit();
}

/** 現時点でリクエストを実行できるか（レンダリング外からも参照できる同期版）。 */
export function canMakeRequest(): boolean {
  return getUsageSnapshot().count < MAX_DAILY_REQUESTS;
}

export type UsageLimitState = {
  used: number;
  remaining: number;
  isExhausted: boolean;
};

/** 当日の利用状況を購読するフック。 */
export function useUsageLimit(): UsageLimitState {
  const usage = useSyncExternalStore(subscribe, getUsageSnapshot, getServerSnapshot);
  const used = Math.min(usage.count, MAX_DAILY_REQUESTS);
  const remaining = Math.max(0, MAX_DAILY_REQUESTS - usage.count);
  return { used, remaining, isExhausted: remaining === 0 };
}
