import { Redis } from "@upstash/redis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuData, WeeklyMenuRecord } from "../../lib/types.ts";
import { getWeekId } from "../../lib/dateUtils.ts";
import { scrapeAllCanteens } from "./scraper.service.ts";
import { detectDishOrigins, generateDishDescriptions } from "./ai.service.ts";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Read-only client. The anon key is sufficient; RLS grants public SELECT. */
function getReadClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Write client. Deliberately throws rather than silently falling back to the
 * anon key: under RLS the anon key cannot write, so the previous fallback
 * turned a missing secret into an update that reported success and persisted
 * nothing.
 */
function getWriteClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — cannot persist the menu.");
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — refusing to write with the anon key, " +
        "which RLS would reject while still reporting success."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Reads the stored menu for a week. Cache, then database, then null.
 *
 * This never scrapes. It used to fall through to a full scrape + AI run on a
 * cache miss, which meant an ordinary page view could trigger the entire
 * weekly pipeline. Producing data is the updater's job (see
 * runWeeklyUpdateService); serving it is this function's.
 */
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
  // app. Only do this for the implicit "current week" request, never when a
  // specific week was asked for.
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
  const data_ = row;

  const record: WeeklyMenuRecord = {
    weekId: data_.week_id,
    menuData: data_.menu_data,
    dishOrigins: data_.dish_origins || {},
    dishDescriptions: data_.dish_descriptions || {},
    scrapedAt: data_.scraped_at,
  };

  // Only cache an exact hit. Caching a fallback under the requested week's key
  // would keep serving the older menu for the whole TTL even after the cron
  // fills in the real one.
  if (redis && record.weekId === targetWeekId) {
    try {
      await redis.set(`menu:${targetWeekId}`, record, { ex: 6 * 60 * 60 });
    } catch (err) {
      console.error("Redis menu write error:", err);
    }
  }

  return record;
}

function extractAllDishes(menuData: MenuData): string[] {
  const dishes = new Set<string>();
  Object.values(menuData.canteens || {}).forEach((canteen) => {
    (canteen.menu || []).forEach((dayItem) => {
      (["no", "en"] as const).forEach((langKey) => {
        const langData = dayItem[langKey];
        if (langData && Array.isArray(langData.items)) {
          langData.items.forEach((it) => {
            if (it.dish && it.dish.trim().length > 0) {
              dishes.add(it.dish.trim());
            }
          });
        }
      });
    });
  });
  return Array.from(dishes);
}

/** True when the scrape produced no dishes at all for any canteen. */
function isEmptyScrape(menuData: MenuData): boolean {
  const canteens = Object.values(menuData.canteens || {});
  if (canteens.length === 0) return true;
  return canteens.every((c) => (c.menu || []).length === 0);
}

/**
 * Scrapes, enriches and persists one week of menus. This is the only writer.
 * Throws on failure so the caller (cron handler / CLI) reports a real error
 * instead of a success with no data behind it.
 */
export async function runWeeklyUpdateService(weekIdInput?: string): Promise<WeeklyMenuRecord> {
  console.log("🚀 Starting weekly menu scrape & AI processing...");

  const menuData = await scrapeAllCanteens();
  const weekId = weekIdInput || getWeekId();

  if (isEmptyScrape(menuData)) {
    // Refuse to overwrite a good week with nothing. An upstream outage or a
    // markup change should page us, not quietly blank the app.
    throw new Error(
      `Scrape produced no menu items for any canteen (${weekId}) — refusing to overwrite stored data.`
    );
  }

  const allDishes = extractAllDishes(menuData);
  console.log(`🔍 Extracted ${allDishes.length} unique dishes.`);

  const [dishOrigins, dishDescriptions] = await Promise.all([
    detectDishOrigins(allDishes),
    generateDishDescriptions(allDishes),
  ]);

  console.log(
    `✨ Processed ${Object.keys(dishOrigins).length} origins and ${Object.keys(dishDescriptions).length} descriptions.`
  );

  const record: WeeklyMenuRecord = {
    weekId,
    menuData,
    dishOrigins,
    dishDescriptions,
    scrapedAt: new Date().toISOString(),
  };

  // Persist first, cache second: the cache must never hold data the database
  // does not, or a failed write would be masked for the whole TTL.
  const supabase = getWriteClient();
  const { error } = await supabase.from("weekly_menus").upsert(
    {
      week_id: weekId,
      menu_data: menuData,
      dish_origins: dishOrigins,
      dish_descriptions: dishDescriptions,
      scraped_at: record.scrapedAt,
    },
    { onConflict: "week_id" }
  );

  // supabase-js resolves with an `error` field rather than rejecting, so this
  // check is what turns a rejected write into a visible failure.
  if (error) {
    throw new Error(`Supabase upsert failed for ${weekId}: ${error.message}`);
  }

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`menu:${weekId}`, record, { ex: 7 * 24 * 60 * 60 });
    } catch (err) {
      console.error("Redis menu write error:", err);
    }
  }

  console.log(`✅ Weekly menu update complete for ${weekId}.`);
  return record;
}
