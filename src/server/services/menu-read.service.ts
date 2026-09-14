import { getRedis } from "./redis.service.js";
import type { WeeklyMenuRecord } from "../../lib/types.js";
import { getWeekId } from "../../lib/dateUtils.js";

/**
 * The read half of the menu, split out of menu.service.ts.
 * Backed by Upstash Redis: reads `menu:<weekId>` directly.
 */

export const MENU_CACHE_TTL_SECONDS = 60 * 60;

export async function getWeeklyMenuService(weekId?: string): Promise<WeeklyMenuRecord | null> {
  const targetWeekId = weekId || getWeekId();
  const redis = getRedis();

  if (!redis) {
    console.error("Redis is not configured — cannot read the menu.");
    return null;
  }

  try {
    const record = await redis.get<WeeklyMenuRecord>(`menu:${targetWeekId}`);
    if (record && record.menuData) return record;

    // Fall back to most recent stored week when the requested one has no entry yet.
    if (!weekId) {
      const latestWeeks = await redis.zrange<string[]>("menu:weeks", 0, 0, { rev: true });
      if (latestWeeks && latestWeeks.length > 0) {
        const latestId = latestWeeks[0];
        if (latestId !== targetWeekId) {
          const fallback = await redis.get<WeeklyMenuRecord>(`menu:${latestId}`);
          if (fallback?.menuData) {
            console.warn(`No stored menu for ${targetWeekId}; serving ${latestId} instead.`);
            return fallback;
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`Redis menu read failed for ${targetWeekId}:`, err?.message ?? err);
  }

  return null;
}
