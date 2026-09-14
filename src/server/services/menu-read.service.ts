import { getRedis } from "./redis.service.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WeeklyMenuRecord } from "../../lib/types.js";
import { getWeekId } from "../../lib/dateUtils.js";

/**
 * The read half of the menu, split out of menu.service.ts.
 *
 * Not an abstraction — a dependency boundary. menu.service.ts imports the
 * scraper (cheerio, 3.6 MB) and ai.service.ts (`@google/genai`, 14 MB) at
 * module scope for the weekly update. `/api/menu` only reads, but sharing a
 * file meant every page view cold-booted all of it: ~19 MB extracted and
 * evaluated to answer a cached select, measured at 4.5s TTFB cold against
 * 0.06-0.19s warm.
 *
 * Keep this module's imports to Supabase and Redis. If something here starts
 * needing the scraper or the model SDK, it belongs on the write side instead.
 */

/** Read-only client. The anon key is sufficient; the app only ever selects. */
export function getReadClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * How long a cached week may outlive the row it was copied from.
 *
 * This was seven days, in front of data that changes twice a day. The only
 * scenario that buys anything is a multi-day Supabase outage — during which the
 * app would confidently serve a week-old menu, which is worse than saying it
 * cannot load one. Everything else it buys is staleness: a write that cannot
 * reach the cache leaves the wrong menu up for a week, and the database looks
 * correct the entire time.
 *
 * An hour still absorbs the traffic this is for — the CDN already caps the
 * origin at one request per five minutes per edge — while bounding any missed
 * invalidation to something shorter than the gap between two cron runs.
 */
export const MENU_CACHE_TTL_SECONDS = 60 * 60;

export async function getWeeklyMenuService(weekId?: string): Promise<WeeklyMenuRecord | null> {
  const targetWeekId = weekId || getWeekId();

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<WeeklyMenuRecord>(`menu:${targetWeekId}`);
      if (cached && cached.menuData) return cached;
    } catch (err) {
      console.error("Redis menu read error:", err);
    }
  }

  const supabase = getReadClient();
  if (!supabase) {
    console.error("Supabase is not configured — cannot read the menu.");
    return null;
  }

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("*")
    .eq("week_id", targetWeekId)
    .maybeSingle();

  if (error) {
    console.error(`Supabase menu read failed for ${targetWeekId}:`, error.message);
    return null;
  }

  // Fall back to the most recent stored week when the requested one has no row
  // yet — e.g. Monday morning before the first cron of the new week lands.
  // Showing last week's menu (which the UI flags as outdated) beats an empty
  // app. Only for the implicit "current week" request, never a specific week.
  let row = data;
  if ((!row || !row.menu_data) && !weekId) {
    const { data: latest, error: latestError } = await supabase
      .from("weekly_menus")
      .select("*")
      .order("week_id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) {
      console.error("Supabase fallback menu read failed:", latestError.message);
      return null;
    }
    if (latest?.menu_data) {
      console.warn(`No stored menu for ${targetWeekId}; serving ${latest.week_id} instead.`);
      row = latest;
    }
  }

  if (!row || !row.menu_data) return null;

  const record: WeeklyMenuRecord = {
    weekId: row.week_id,
    menuData: row.menu_data,
    dishOrigins: row.dish_origins || {},
    dishDescriptions: row.dish_descriptions || {},
    dishShortNames: row.dish_short_names || {},
    scrapedAt: row.scraped_at,
  };

  // Only cache an exact hit. Caching a fallback under the requested week's key
  // would keep serving the older menu for the whole TTL even after the cron
  // fills in the real one.
  if (redis && record.weekId === targetWeekId) {
    // Not awaited. This is a cache write for the NEXT request; the caller
    // already has the record in hand, so awaiting it only adds a round trip to
    // this request's own critical path — and this path is the cold miss, which
    // is exactly the request that can least afford one. A failure is logged and
    // costs nothing but a repeated miss.
    void redis
      .set(`menu:${targetWeekId}`, record, { ex: MENU_CACHE_TTL_SECONDS })
      .catch((err) => console.error("Redis menu write error:", err));
  }

  return record;
}
