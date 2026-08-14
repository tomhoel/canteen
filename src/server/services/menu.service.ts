import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuData, WeeklyMenuRecord, DishOrigin, DishDescription } from "../../lib/types.js";
import { getWeekId, parseCanteenWeekNumber, weekIdForWeekNumber } from "../../lib/dateUtils.js";
import { scrapeAllCanteens, type ScrapeReport } from "./scraper.service.js";
import { detectDishOrigins, generateDishDescriptions } from "./ai.service.js";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
  type DishCacheEntry,
} from "./dish-cache.service.js";

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

/** What one week's row received from a single scrape. */
export interface WeekWriteResult {
  weekId: string;
  /** Canteens whose published week label routed them here. */
  canteens: string[];
  dishCount: number;
  fromCache: number;
  generated: number;
  unchanged: boolean;
}

export interface WeeklyUpdateResult extends WeeklyMenuRecord {
  stats: UpdateStats;
  scrape: ScrapeReport;
  /**
   * Every week this scrape wrote. Usually one; two while the kitchens roll over
   * to next week, which they do at different times on a Thursday or Friday.
   */
  weeksWritten: WeekWriteResult[];
  /** Weeks left untouched because their stored row could not be read. */
  weeksSkipped: Array<{ weekId: string; reason: string }>;
}

/**
 * Routes each canteen to the week it says its menu is for.
 *
 * The canteens publish one week at a time and flip to the next at their own
 * pace — on the Friday this was written, two had moved to week 34 while the
 * third was still on 33. Keying the whole scrape off the calendar week wrote
 * next week's food into this week's row, which is how the stored 2026-W34 row
 * ended up holding two canteens' week-33 menus.
 *
 * An unparseable label falls back to the calendar week rather than dropping the
 * canteen: a missing menu is worse than one filed under a debatable key.
 */
export function groupCanteensByPublishedWeek(
  menuData: MenuData,
  fallbackWeekId: string
): Map<string, MenuData["canteens"]> {
  const groups = new Map<string, MenuData["canteens"]>();

  for (const [name, canteen] of Object.entries(menuData.canteens || {})) {
    const weekNumber = parseCanteenWeekNumber(canteen.week);
    const weekId = weekNumber === null ? fallbackWeekId : weekIdForWeekNumber(weekNumber);
    if (!groups.has(weekId)) groups.set(weekId, {});
    groups.get(weekId)![name] = canteen;
  }

  return groups;
}

/**
 * Builds one week's canteen set from three sources, weakest first.
 *
 * 1. `stored` — what the row already holds. Merged rather than replaced, so a
 *    canteen that has not rolled over cannot erase one that has.
 * 2. `allScraped` — every canteen in this scrape, regardless of which week it
 *    published, used only to fill a canteen the row has never heard of. Without
 *    this, the row created for next week holds only the kitchens that rolled
 *    over early and the laggard vanishes from the app the moment that week
 *    becomes current. The seeded entry keeps its own `week` label, so the card
 *    renders with the existing "outdated" badge rather than pretending.
 * 3. `thisWeek` — the canteens that actually published this week. Authoritative.
 */
export function mergeCanteensForWeek(
  stored: MenuData["canteens"] | undefined,
  allScraped: MenuData["canteens"],
  thisWeek: MenuData["canteens"]
): MenuData["canteens"] {
  const merged: MenuData["canteens"] = { ...(stored ?? {}) };

  for (const [name, canteen] of Object.entries(allScraped)) {
    if (!merged[name]) merged[name] = canteen;
  }

  return Object.assign(merged, thisWeek);
}

/**
 * Thrown when a multi-week run fails after some weeks are already committed.
 *
 * The write loop is not a transaction — each week is its own upsert — so unlike
 * the previous single-write updater, a failure here does not mean the stored
 * data is untouched. Callers reporting the failure need to say which weeks did
 * land.
 */
export class PartialUpdateError extends Error {
  constructor(message: string, readonly weeksWritten: WeekWriteResult[]) {
    super(message);
    this.name = "PartialUpdateError";
  }
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
  const displayWeekId = getWeekId();
  const fallbackWeekId = weekIdInput || displayWeekId;

  if (isEmptyScrape(menuData)) {
    // Refuse to overwrite a good week with nothing. An upstream outage or a
    // markup change should page us, not quietly blank the app.
    throw new Error(
      `Scrape produced no menu items for any canteen (${fallbackWeekId}) — refusing to overwrite stored data. ` +
        scrape.results.map((r) => `${r.canteen.displayName}: ${r.error ?? "ok"}`).join("; ")
    );
  }

  // An explicit week id is a manual override ("rebuild 2026-W31"), so it wins
  // over whatever the canteens currently advertise.
  const groups = weekIdInput
    ? new Map([[weekIdInput, menuData.canteens || {}]])
    : groupCanteensByPublishedWeek(menuData, fallbackWeekId);

  if (groups.size > 1) {
    console.log(
      `📆 Canteens are mid-rollover — routing to ${[...groups.keys()].sort().join(" and ")}.`
    );
  }

  const supabase = getWriteClient();
  const redis = getRedis();
  const scrapedAt = new Date().toISOString();
  const weeksWritten: WeekWriteResult[] = [];
  const weeksSkipped: Array<{ weekId: string; reason: string }> = [];
  const writtenRecords = new Map<string, WeeklyMenuRecord>();

  for (const weekId of [...groups.keys()].sort()) {
    const scrapedCanteens = groups.get(weekId)!;

    const stored = await getStoredRow(weekId);
    if (!stored.ok) {
      // Writing now would merge into an assumed-empty row and delete every
      // canteen this scrape did not see. Skipping costs one stale week until
      // the next run; guessing costs menus that no longer exist upstream.
      console.error(`⛔ ${weekId} skipped — could not read the stored row: ${stored.error}`);
      weeksSkipped.push({ weekId, reason: stored.error });
      continue;
    }
    const existing = stored.row;

    const mergedCanteens = mergeCanteensForWeek(
      existing?.menuData?.canteens,
      menuData.canteens || {},
      scrapedCanteens
    );
    const weekMenuData: MenuData = { ...menuData, canteens: mergedCanteens };

    const allDishes = extractAllDishes(weekMenuData);
    const fingerprint = fingerprintScrape(weekMenuData);
    const unchanged = !force && existing?.fingerprint === fingerprint;

    let dishOrigins: Record<string, DishOrigin> = existing?.dishOrigins ?? {};
    let dishDescriptions: Record<string, DishDescription> = existing?.dishDescriptions ?? {};
    let fromCache = 0;
    let generated = 0;

    if (unchanged) {
      console.log(`✅ ${weekId} identical to the stored week — skipping enrichment.`);
    } else {
      const enriched = await enrichDishes(allDishes);
      dishOrigins = enriched.origins;
      dishDescriptions = enriched.descriptions;
      fromCache = enriched.fromCache;
      generated = enriched.generated;
    }

    const record: WeeklyMenuRecord = {
      weekId,
      menuData: weekMenuData,
      dishOrigins,
      dishDescriptions,
      scrapedAt,
    };

    // Persist first, cache second: the cache must never hold data the database
    // does not, or a failed write would be masked for the whole TTL.
    const { error } = await supabase.from("weekly_menus").upsert(
      {
        week_id: weekId,
        // The fingerprint rides inside menu_data so no schema change is needed.
        menu_data: { ...weekMenuData, fingerprint },
        dish_origins: dishOrigins,
        dish_descriptions: dishDescriptions,
        scraped_at: scrapedAt,
      },
      { onConflict: "week_id" }
    );

    // supabase-js resolves with an `error` field rather than rejecting, so this
    // check is what turns a rejected write into a visible failure. Weeks
    // committed before this point stay committed, so the error carries them —
    // an alert claiming nothing was touched would send someone looking in the
    // wrong place.
    if (error) {
      throw new PartialUpdateError(
        `Supabase upsert failed for ${weekId}: ${error.message}`,
        [...weeksWritten]
      );
    }

    if (redis) {
      try {
        await redis.set(`menu:${weekId}`, record, { ex: 7 * 24 * 60 * 60 });
      } catch (err) {
        console.error("Redis menu write error:", err);
      }
    }

    writtenRecords.set(weekId, record);
    weeksWritten.push({
      weekId,
      canteens: Object.keys(scrapedCanteens),
      dishCount: allDishes.length,
      fromCache,
      generated,
      unchanged,
    });

    console.log(
      `✅ ${weekId} stored — ${allDishes.length} dishes (${fromCache} cached, ${generated} new)` +
        ` from ${Object.keys(scrapedCanteens).join(", ")}`
    );
  }

  if (weeksWritten.length === 0) {
    // Every week was skipped, so the run achieved nothing. Fail loudly rather
    // than returning a record that suggests otherwise.
    throw new Error(
      `No week could be written — the stored rows could not be read: ` +
        weeksSkipped.map((w) => `${w.weekId} (${w.reason})`).join("; ")
    );
  }

  // Plate images live in per-day, per-canteen slots with no week dimension, so
  // only one week's plates can exist at a time. They must therefore depict the
  // week the app is actually rendering — not whichever week this scrape
  // happened to catch, which on a Friday afternoon is already the next one.
  //
  // An explicit weekIdInput is the exception: the caller named a week, so that
  // is the one to return and to build plates for.
  const primary = weekIdInput
    ? writtenRecords.get(weekIdInput)!
    : writtenRecords.get(displayWeekId) ??
      (await getWeeklyMenuService(displayWeekId)) ??
      writtenRecords.get([...writtenRecords.keys()].sort()[0])!;

  const primaryWrite = weeksWritten.find((w) => w.weekId === primary.weekId);
  const stats: UpdateStats = {
    weekId: primary.weekId,
    dishCount: primaryWrite?.dishCount ?? extractAllDishes(primary.menuData).length,
    fromCache: weeksWritten.reduce((n, w) => n + w.fromCache, 0),
    generated: weeksWritten.reduce((n, w) => n + w.generated, 0),
    failedCanteens: scrape.failed,
    // Nothing to regenerate downstream unless the displayed week itself moved.
    unchanged: primaryWrite ? primaryWrite.unchanged : true,
  };

  if (scrape.failed.length) console.log(`⚠️  failed: ${scrape.failed.join(", ")}`);

  return { ...primary, stats, scrape, weeksWritten, weeksSkipped };
}

interface StoredRow {
  fingerprint?: string;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  /** The stored week, so a partial scrape can be merged into it. */
  menuData: MenuData | null;
}

/**
 * Reads the stored row for a week, including the embedded fingerprint.
 *
 * `ok: false` and `row: null` are deliberately different answers. The write path
 * merges this scrape into whatever is already stored, so "the row has no
 * canteens" and "I could not find out what the row holds" must never collapse
 * into the same value: treating a failed read as an empty row turns the merge
 * into a full replace and deletes the canteens this scrape did not see. Once
 * those kitchens have rolled over to the next week, their old page is gone
 * upstream and no later run can restore it.
 */
async function getStoredRow(
  weekId: string
): Promise<{ ok: true; row: StoredRow | null } | { ok: false; error: string }> {
  const supabase = getReadClient();
  if (!supabase) return { ok: false, error: "Supabase is not configured" };

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("menu_data, dish_origins, dish_descriptions")
    .eq("week_id", weekId)
    .maybeSingle();

  // supabase-js resolves rather than rejects, so a network blip or a PostgREST
  // 5xx arrives here as a populated `error` — not as a throw.
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, row: null };

  return {
    ok: true,
    row: {
      fingerprint: data.menu_data?.fingerprint,
      dishOrigins: data.dish_origins ?? {},
      dishDescriptions: data.dish_descriptions ?? {},
      menuData: (data.menu_data as MenuData) ?? null,
    },
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

  Object.assign(origins, newOrigins.values);
  Object.assign(descriptions, newDescriptions.values);

  // Cache only what the model actually answered. Both passes fill their gaps
  // with a pattern fallback so nothing renders blank, but persisting those
  // would bake a rate-limited afternoon into dish_cache permanently — the
  // entry is a cache hit forever after, so the dish is never asked about again.
  // Displaying a fallback for one run is cheap; storing it is not.
  const durable = missing.filter(
    (dish) => newOrigins.fromModel.has(dish) && newDescriptions.fromModel.has(dish)
  );

  // Preserve any image path already recorded against the same key.
  const entries: DishCacheEntry[] = durable.map((dish) => {
    const key = normalizeDishName(dish);
    const hit = cache.get(key);
    return {
      cacheKey: key,
      originalName: dish,
      origin: newOrigins.values[dish] ?? hit?.origin ?? null,
      description: newDescriptions.values[dish] ?? hit?.description ?? null,
      imagePath: hit?.imagePath ?? null,
      imageNoBgPath: hit?.imageNoBgPath ?? null,
    };
  });

  const saved = await saveDishCacheEntries(entries);
  const skipped = missing.length - durable.length;
  console.log(
    `🗃️  ${saved} dishes written back to dish_cache` +
      (skipped ? `; ${skipped} left uncached (model did not answer, will retry next run).` : ".")
  );

  return { origins, descriptions, fromCache, generated: missing.length };
}
