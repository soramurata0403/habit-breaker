import {
  SERVER_BURST_LIMIT,
  SERVER_BURST_WINDOW_MS,
  SERVER_MAX_DAILY_REQUESTS,
} from "@/lib/config";

type Entry = {
  /** YYYY-MM-DD（UTC）。日付が変わるとカウントをリセットする。 */
  date: string;
  count: number;
  /** バースト判定用に保持する、直近リクエストのタイムスタンプ。 */
  recent: number[];
};

// インメモリのため、サーバー再起動や複数インスタンスではカウントが
// リセット・分散する。あくまでコスト急増に対する簡易的な歯止めとして扱う。
const buckets = new Map<string, Entry>();

// 際限なくメモリを消費しないよう、一定数を超えたら当日以外のエントリを掃除する。
const MAX_TRACKED_CLIENTS = 5000;

function utcDateKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function prune(today: string): void {
  if (buckets.size <= MAX_TRACKED_CLIENTS) return;
  for (const [key, entry] of buckets) {
    if (entry.date !== today) buckets.delete(key);
  }
  // それでも減らない場合（全件が当日）は、最も古いものから落とす。
  if (buckets.size > MAX_TRACKED_CLIENTS) {
    const excess = buckets.size - MAX_TRACKED_CLIENTS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  }
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

/**
 * IP単位の簡易レートリミット。
 * - 短時間の連打（バースト）を時間窓で制限する
 * - 1日あたりの総リクエスト数を制限する
 */
export function checkRateLimit(request: Request): RateLimitResult {
  const now = Date.now();
  const today = utcDateKey(now);
  const key = clientKey(request);

  let entry = buckets.get(key);
  if (!entry || entry.date !== today) {
    entry = { date: today, count: 0, recent: [] };
    buckets.set(key, entry);
    prune(today);
  }

  // 時間窓から外れたタイムスタンプを捨てる。
  const windowStart = now - SERVER_BURST_WINDOW_MS;
  entry.recent = entry.recent.filter((timestamp) => timestamp > windowStart);

  if (entry.recent.length >= SERVER_BURST_LIMIT) {
    const oldest = entry.recent[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + SERVER_BURST_WINDOW_MS - now) / 1000),
    );
    return {
      ok: false,
      status: 429,
      error: "リクエストが多すぎます。少し時間をおいてからお試しください。",
      retryAfterSeconds,
    };
  }

  if (entry.count >= SERVER_MAX_DAILY_REQUESTS) {
    return {
      ok: false,
      status: 429,
      error: "本日の利用上限に達しました。明日またお試しください。",
    };
  }

  entry.recent.push(now);
  entry.count += 1;
  return { ok: true };
}

/** レートリミットに掛かった場合の共通レスポンス。 */
export function rateLimitResponse(result: Extract<RateLimitResult, { ok: false }>): Response {
  return Response.json(
    { error: result.error },
    {
      status: result.status,
      headers: result.retryAfterSeconds
        ? { "Retry-After": String(result.retryAfterSeconds) }
        : undefined,
    },
  );
}
