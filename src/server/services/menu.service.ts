import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuData, WeeklyMenuRecord, DishOrigin, DishDescription } from "../../lib/types.ts";
import { getWeekId } from "../../lib/dateUtils.ts";
import { scrapeAllCanteens, type ScrapeReport } from "./scraper.service.ts";
import { detectDishOrigins, generateDishDescriptions } from "./ai.service.ts";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
  type DishCacheEntry,
} from "./dish-cache.service.ts";

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/** Read-only client. The anon key is sufficient; the app only ever selects. */
function getReadClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Write client. Deliberately throws rather than silently falling back to the
 * anon key: the anon key is a public credential, and the updater must not be
 * able to write with it.
 */
function getWriteClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — cannot persist the menu.");
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — refusing to write with the anon key.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

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
    scrapedAt: row.scraped_at,
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

/** Every distinct non-empty dish name in a week, both languages. */
function extractAllDishes(menuData: MenuData): string[] {
  const dishes = new Set<string>();
  Object.values(menuData.canteens || {}).forEach((canteen) => {
    (canteen.menu || []).forEach((dayItem) => {
      (["no", "en"] as const).forEach((lang) => {
        (dayItem[lang]?.items ?? []).forEach((it) => {
          if (it.dish?.trim()) dishes.add(it.dish.trim());
        });
      });
    });
  });
  return Array.from(dishes);
}

/**
 * Stable hash of the dish names a scrape produced.
 *
 * Used to skip the enrichment pass when nothing changed. Deliberately ignores
 * `scrapedAt` and ranking flags, which differ on every run, so it only moves
 * when the kitchens actually publish something new.
 */
function fingerprintScrape(menuData: MenuData): string {
  const canonical = Object.keys(menuData.canteens || {})
    .sort()
    .map((name) => {
      const canteen = menuData.canteens[name];
      const days = (canteen.menu || [])
        .map((d) => {
          const items = (["no", "en"] as const)
            .map((lang) => (d[lang]?.items ?? []).map((i) => i.dish).join("|"))
            .join("~");
          return `${d.day}:${items}`;
        })
        .join(";");
      return `${name}[${canteen.week}]{${days}}`;
    })
    .join("||");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export interface UpdateStats {
  weekId: string;
  dishCount: number;
  /** Dishes served straight from dish_cache, costing no model calls. */
  fromCache: number;
  /** Dishes sent to the model because they had never been seen before. */
  generated: number;
  /** Canteens that returned nothing usable this run. */
  failedCanteens: string[];
  /** True when the scrape matched the stored one and enrichment was skipped. */
  unchanged: boolean;
}

export interface WeeklyUpdateResult extends WeeklyMenuRecord {
  stats: UpdateStats;
  scrape: ScrapeReport;
}

/** True when the scrape produced no dishes at all for any canteen. */
function isEmptyScrape(menuData: MenuData): boolean {
  const canteens = Object.values(menuData.canteens || {});
  if (canteens.length === 0) return true;
  return canteens.every((c) => (c.menu || []).length === 0);
}

/**
 * Scrapes, enriches and persists one week of menus. The only writer.
 *
 * Enrichment is incremental: dish names already in `dish_cache` reuse their
 * stored origin and description, so the model is only asked about dishes
 * nobody has seen before. On a typical run that is zero, and the whole pass
 * costs one table read.
 */
export async function runWeeklyUpdateService(
  weekIdInput?: string,
  options: { force?: boolean } = {}
): Promise<WeeklyUpdateResult> {
  const { force = false } = options;
  console.log("🚀 Starting weekly menu scrape...");

  const scrape = await scrapeAllCanteens();
  const { menuData } = scrape;
  const weekId = weekIdInput || getWeekId();

  if (isEmptyScrape(menuData)) {
    // Refuse to overwrite a good week with nothing. An upstream outage or a
    // markup change should page us, not quietly blank the app.
    throw new Error(
      `Scrape produced no menu items for any canteen (${weekId}) — refusing to overwrite stored data. ` +
        scrape.results.map((r) => `${r.canteen.displayName}: ${r.error ?? "ok"}`).join("; ")
    );
  }

  const allDishes = extractAllDishes(menuData);
  const fingerprint = fingerprintScrape(menuData);
  console.log(`🔍 ${allDishes.length} distinct dishes; fingerprint ${fingerprint}`);

  const existing = await getStoredRow(weekId);
  const unchanged = !force && existing?.fingerprint === fingerprint;

  let dishOrigins: Record<string, DishOrigin> = existing?.dishOrigins ?? {};
  let dishDescriptions: Record<string, DishDescription> = existing?.dishDescriptions ?? {};
  let fromCache = 0;
  let generated = 0;

  if (unchanged) {
    console.log("✅ Scrape identical to the stored week — skipping enrichment.");
  } else {
    const enriched = await enrichDishes(allDishes);
    dishOrigins = enriched.origins;
    dishDescriptions = enriched.descriptions;
    fromCache = enriched.fromCache;
    generated = enriched.generated;
  }

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
      // The fingerprint rides inside menu_data so no schema change is needed.
      menu_data: { ...menuData, fingerprint },
      dish_origins: dishOrigins,
      dish_descriptions: dishDescriptions,
      scraped_at: record.scrapedAt,
    },
    { onConflict: "week_id" }
  );

  // supabase-js resolves with an `error` field rather than rejecting, so this
  // check is what turns a rejected write into a visible failure.
  if (error) throw new Error(`Supabase upsert failed for ${weekId}: ${error.message}`);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`menu:${weekId}`, record, { ex: 7 * 24 * 60 * 60 });
    } catch (err) {
      console.error("Redis menu write error:", err);
    }
  }

  const stats: UpdateStats = {
    weekId,
    dishCount: allDishes.length,
    fromCache,
    generated,
    failedCanteens: scrape.failed,
    unchanged,
  };

  console.log(
    `✅ ${weekId} stored — ${allDishes.length} dishes (${fromCache} cached, ${generated} new)` +
      (scrape.failed.length ? `, failed: ${scrape.failed.join(", ")}` : "")
  );

  return { ...record, stats, scrape };
}

/** Reads the stored row for a week, including the embedded fingerprint. */
async function getStoredRow(weekId: string): Promise<{
  fingerprint?: string;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
} | null> {
  const supabase = getReadClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("menu_data, dish_origins, dish_descriptions")
    .eq("week_id", weekId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    fingerprint: data.menu_data?.fingerprint,
    dishOrigins: data.dish_origins ?? {},
    dishDescriptions: data.dish_descriptions ?? {},
  };
}

/**
 * Resolves an origin and description for every dish, using the cache first.
 *
 * Only genuinely unseen dishes reach the model, and whatever it returns is
 * written back so the next run gets them for free.
 */
async function enrichDishes(dishes: string[]): Promise<{
  origins: Record<string, DishOrigin>;
  descriptions: Record<string, DishDescription>;
  fromCache: number;
  generated: number;
}> {
  const cache = await loadDishCache(dishes);

  const origins: Record<string, DishOrigin> = {};
  const descriptions: Record<string, DishDescription> = {};
  const missing: string[] = [];
  let fromCache = 0;

  for (const dish of dishes) {
    const hit = cache.get(normalizeDishName(dish));
    if (hit?.origin && hit?.description) {
      origins[dish] = hit.origin;
      descriptions[dish] = hit.description;
      fromCache++;
    } else {
      missing.push(dish);
    }
  }

  console.log(`🗃️  ${fromCache} dishes from cache, ${missing.length} to generate.`);
  if (missing.length === 0) return { origins, descriptions, fromCache, generated: 0 };

  const [newOrigins, newDescriptions] = await Promise.all([
    detectDishOrigins(missing),
    generateDishDescriptions(missing),
  ]);

  Object.assign(origins, newOrigins);
  Object.assign(descriptions, newDescriptions);

  // Write the new dishes back so this cost is never paid twice. Preserve any
  // image path already recorded against the same key.
  const entries: DishCacheEntry[] = missing.map((dish) => {
    const key = normalizeDishName(dish);
    const hit = cache.get(key);
    return {
      cacheKey: key,
      originalName: dish,
      origin: newOrigins[dish] ?? hit?.origin ?? null,
      description: newDescriptions[dish] ?? hit?.description ?? null,
      imagePath: hit?.imagePath ?? null,
      imageNoBgPath: hit?.imageNoBgPath ?? null,
    };
  });

  const saved = await saveDishCacheEntries(entries);
  console.log(`🗃️  ${saved} dishes written back to dish_cache.`);

  return { origins, descriptions, fromCache, generated: missing.length };
}
