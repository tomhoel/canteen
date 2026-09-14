import { getRedis } from "./redis.service.js";
import { getLocalDateKey } from "../../lib/dateUtils.js";

/**
 * Where the lunch vote lives: backed by Upstash Redis hashes.
 *
 * Votes for each day are stored in an Upstash Redis hash `attendance:<YYYY-MM-DD>`,
 * where field is the canteen name and value is the integer vote count.
 * Increments are atomic using `HINCRBY`.
 */

/** The window the leaderboard renders: today plus the previous 13 days. */
export const HISTORY_DAYS = 14;

export interface HistoryEntry {
  /** Oslo calendar day, `YYYY-MM-DD`. */
  date: string;
  canteens: Record<string, number>;
}

function requireRedis() {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "Vote storage is not configured: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN " +
        "must be set on this deployment."
    );
  }
  return redis;
}

/**
 * Records one vote and returns the day's tally as Redis now holds it.
 *
 * Uses atomic `HINCRBY` so concurrent votes cannot overwrite each other.
 */
export async function submitVoteService(canteenId: string) {
  const redis = requireRedis();
  const dateKey = getLocalDateKey();

  try {
    await redis.hincrby(`attendance:${dateKey}`, canteenId, 1);
    const raw = await redis.hgetall<Record<string, number | string>>(`attendance:${dateKey}`);

    const canteens: Record<string, number> = {};
    if (raw) {
      for (const [name, count] of Object.entries(raw)) {
        canteens[name] = typeof count === "number" ? count : parseInt(String(count), 10) || 0;
      }
    }

    return { success: true as const, canteens };
  } catch (err: any) {
    throw new Error(`Vote could not be recorded: ${err?.message ?? err}`);
  }
}

/**
 * The last `days` days of tallies, newest day first.
 */
export async function getAttendanceHistoryService(
  days: number = HISTORY_DAYS
): Promise<{ entries: HistoryEntry[] }> {
  const redis = requireRedis();
  const todayMs = Date.parse(`${getLocalDateKey()}T00:00:00Z`);

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(todayMs - i * 86_400_000).toISOString().slice(0, 10);
    dates.push(d);
  }

  try {
    const pipeline = redis.pipeline();
    for (const date of dates) {
      pipeline.hgetall(`attendance:${date}`);
    }

    const results = await pipeline.exec<Array<Record<string, number | string> | null>>();

    const entries: HistoryEntry[] = [];
    for (let i = 0; i < dates.length; i++) {
      const raw = results[i];
      if (raw && Object.keys(raw).length > 0) {
        const canteens: Record<string, number> = {};
        for (const [name, count] of Object.entries(raw)) {
          canteens[name] = typeof count === "number" ? count : parseInt(String(count), 10) || 0;
        }
        entries.push({ date: dates[i], canteens });
      }
    }

    return { entries };
  } catch (err: any) {
    throw new Error(`Vote history could not be read: ${err?.message ?? err}`);
  }
}
