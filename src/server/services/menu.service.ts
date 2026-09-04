import { createHash } from "node:crypto";
import { getRedis } from "./redis.service.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  MenuData,
  DayEntry,
  WeeklyMenuRecord,
  DishOrigin,
  DishDescription,
} from "../../lib/types.js";
import {
  getWeekId,
  getWeekNumber,
  osloWeekdayIndex,
  parseCanteenWeekNumber,
  weekDistance,
  weekIdForWeekNumber,
} from "../../lib/dateUtils.js";
import { DAY_KEYS } from "../../lib/constants.js";
import {
  scrapeAllCanteens,
  scrapeAllDailyMenus,
  type ScrapeReport,
  type DailyScrapeResult,
} from "./scraper.service.js";
import {
  detectDishOrigins,
  generateDishDescriptions,
  cleanDishTitles,
  fallbackOrigin,
  fallbackDescription,
} from "./ai.service.js";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
  activeEnrichAttempts,
  isEnrichmentExhausted,
  MAX_ENRICH_ATTEMPTS,
  type DishCacheEntry,
} from "./dish-cache.service.js";

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
const MENU_CACHE_TTL_SECONDS = 60 * 60;

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
      await redis.set(`menu:${targetWeekId}`, record, { ex: MENU_CACHE_TTL_SECONDS });
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

/** Every distinct non-empty Norwegian dish name in a week. */
export function extractNoDishes(menuData: MenuData): string[] {
  const dishes = new Set<string>();
  Object.values(menuData.canteens || {}).forEach((canteen) => {
    (canteen.menu || []).forEach((dayItem) => {
      (dayItem.no?.items ?? []).forEach((it) => {
        if (it.dish?.trim()) dishes.add(it.dish.trim());
      });
    });
  });
  return Array.from(dishes);
}

/**
 * Apply title corrections to all Norwegian menu items in place.
 * Returns the total number of item instances updated.
 */
export function applyTitleCorrections(
  menuData: MenuData,
  corrections: Record<string, string>
): number {
  let count = 0;
  if (!corrections || Object.keys(corrections).length === 0) return 0;

  for (const canteen of Object.values(menuData.canteens || {})) {
    for (const dayEntry of canteen.menu || []) {
      for (const item of dayEntry.no?.items || []) {
        if (item.dish && corrections[item.dish]) {
          item.dish = corrections[item.dish];
          count++;
        }
      }
    }
  }
  return count;
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

/**
 * What an enrichment pass cost and what it left behind.
 *
 * `sentToModel` used to be reported as `generated`, which was a lie in the
 * direction that matters: it counted dishes *asked about*, not dishes durably
 * answered for. A run that asked about forty dishes and got nothing back
 * reported forty "generated", so a silently failing model looked identical to a
 * working one.
 */
export interface EnrichmentCounts {
  /** Dishes served straight from dish_cache, costing no model calls. */
  fromCache: number;
  /** Dishes put in front of the model this run, for either field. */
  sentToModel: number;
  /** Dishes that gained at least one durably cached field this run. */
  durablyCached: number;
  /** Dishes still rendering a pattern fallback for origin or description. */
  unresolved: string[];
  /** Dishes that have used up their retries and will not be sent again. */
  exhausted: string[];
  /**
   * Dishes that used up their last retry on *this* run.
   *
   * Separate from `exhausted` so the alert fires once. An exhausted dish stays
   * exhausted for as long as it is on the menu — up to ten cron runs — and an
   * alert keyed on `exhausted` would repeat every one of them, which is how a
   * channel gets muted.
   */
  newlyExhausted: string[];
}

export interface UpdateStats extends EnrichmentCounts {
  weekId: string;
  dishCount: number;
  /** Canteens that returned nothing usable this run. */
  failedCanteens: string[];
  /**
   * True when the *displayed* week's stored menu matched this scrape dish for
   * dish — and true by default when the displayed week was not written at all,
   * because there is then nothing new to regenerate downstream. Deliberately
   * not a statement about the run as a whole: during a rollover another week
   * may well have changed.
   */
  displayedWeekUnchanged: boolean;
}

/** What one week's row received from a single scrape. */
export interface WeekWriteResult extends EnrichmentCounts {
  weekId: string;
  /** Canteens whose published week label routed them here. */
  canteens: string[];
  dishCount: number;
  unchanged: boolean;
  /**
   * The week as written, so the caller can build plate images for every week
   * this run touched rather than only the displayed one. Not part of the JSON
   * the cron endpoint returns — see how it is stripped there.
   */
  menuData: MenuData;
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
  const currentWeek = getWeekNumber();

  for (const [name, canteen] of Object.entries(menuData.canteens || {})) {
    const weekNumber = parseCanteenWeekNumber(canteen.week);
    const weekId =
      weekNumber === null || !isPlausibleWeek(weekNumber, currentWeek)
        ? fallbackWeekId
        : weekIdForWeekNumber(weekNumber);
    if (!groups.has(weekId)) groups.set(weekId, {});
    groups.get(weekId)![name] = canteen;
  }

  return groups;
}

/**
 * How far from the calendar week a canteen's own label is still allowed to
 * route it to its own row.
 *
 * The kitchens publish one week at a time and roll over up to a few days early,
 * so `+1` is routine and `+2` is generous headroom. Behind is the mirror case —
 * a kitchen that has not updated yet. Anything further out is not a canteen
 * planning ahead, it is a misread label: "Bygg 2" parses as week 2, which in
 * August resolves to 2027-W02 and files that canteen's entire menu into a row
 * the app will not look at until January. A week id, once written, is a
 * permanent primary key — there is no delete path in this codebase — and it
 * also outranks every real row in the "most recent stored week" fallback, which
 * orders by week_id descending.
 *
 * Rejected numbers fall back to the calendar week, which is what the whole
 * pipeline did before per-week routing existed. The canteen still shows up; its
 * own stale label is what makes the UI badge the card outdated.
 */
const MAX_ROUTING_DISTANCE_WEEKS = 2;

function isPlausibleWeek(weekNumber: number, currentWeek: number): boolean {
  const distance = weekDistance(weekNumber, currentWeek);
  if (Math.abs(distance) <= MAX_ROUTING_DISTANCE_WEEKS) return true;
  console.warn(
    `⚠️  Ignoring implausible published week ${weekNumber} (${distance > 0 ? "+" : ""}${distance} ` +
      `weeks from the calendar week ${currentWeek}) — filing under the calendar week instead.`
  );
  return false;
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

/** "friday" -> "Friday", matching the day names the weekly scraper writes. */
function dayEntryName(dayKey: string): string {
  return dayKey.charAt(0).toUpperCase() + dayKey.slice(1);
}

/**
 * Reshapes the daily boards into a `MenuData` so the rest of the pipeline can
 * treat them like any other scrape.
 *
 * The only reason this exists is `applyTitleCorrections`, which walks a
 * `MenuData`. Giving today's dishes that shape means they go through the same
 * Norwegian proofreading pass as the weekly menu instead of bypassing it — and
 * bypassing it would matter twice over, because the corrected title is also
 * the dish-cache key that enrichment and the plate images are looked up by.
 */
export function buildDailyMenuData(
  results: DailyScrapeResult[],
  todayKey: string
): MenuData {
  const canteens: MenuData["canteens"] = {};

  for (const result of results) {
    if (!result.daily) continue;
    const { no, en } = result.daily;
    canteens[result.canteen.displayName] = {
      // No week label: the daily board does not carry one, and inventing one
      // would feed `groupCanteensByPublishedWeek` a number it did not publish.
      week: "",
      openingHours: result.canteen.hours,
      menu: [{ day: dayEntryName(todayKey), ...(no ? { no } : {}), ...(en ? { en } : {}) }],
    };
  }

  return { scrapedAt: new Date().toISOString(), canteens };
}

/**
 * Replaces today's slot with what the kitchen actually served.
 *
 * Returns the canteens it changed, for the log.
 *
 * Three things it deliberately does not do:
 *
 * - It never adds a canteen. If the week's row has never heard of a canteen,
 *   a single day's dishes are not enough to introduce it — the card would have
 *   one day of food and four blanks.
 * - It never drops a language. A board published only in Norwegian overrides
 *   the Norwegian column and leaves the English weekly menu in place, rather
 *   than blanking a column the kitchen simply did not fill in that morning.
 * - It never mutates in place. The `CanteenData` objects here are shared with
 *   the raw scrape, which the write loop reuses for every other week in the
 *   run, so an in-place edit for this week would leak into the next one.
 */
export function applyDailyOverride(
  weekMenuData: MenuData,
  daily: MenuData,
  todayKey: string
): string[] {
  const overridden: string[] = [];

  for (const [name, dailyCanteen] of Object.entries(daily.canteens || {})) {
    const target = weekMenuData.canteens?.[name];
    if (!target) continue;

    const source = dailyCanteen.menu?.[0];
    if (!source || (!source.no && !source.en)) continue;

    const menu = [...(target.menu ?? [])];
    const index = menu.findIndex((d) => d.day?.toLowerCase() === todayKey);
    const existing = index >= 0 ? menu[index] : undefined;

    const replacement: DayEntry = {
      day: existing?.day ?? dayEntryName(todayKey),
      ...(source.no ? { no: source.no } : existing?.no ? { no: existing.no } : {}),
      ...(source.en ? { en: source.en } : existing?.en ? { en: existing.en } : {}),
    };

    if (index >= 0) {
      menu[index] = replacement;
    } else {
      // The weekly widget never published today at all — a real case when a
      // kitchen rolls over mid-week. Keep Monday-to-Friday order.
      menu.push(replacement);
      menu.sort(
        (a, b) =>
          DAY_KEYS.indexOf(a.day.toLowerCase()) - DAY_KEYS.indexOf(b.day.toLowerCase())
      );
    }

    weekMenuData.canteens[name] = { ...target, menu };
    overridden.push(name);
  }

  return overridden;
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

  // Today's dishes come from a second widget — the "DAGENS LUNSJ" board that
  // hangs by the counter — because the weekly menu is a plan and that board is
  // the food. A kitchen that rolled its weekly widget over to next week early
  // leaves the current week holding a draft nobody cooked, and until now the
  // app served that draft. This is the correction.
  //
  // The board carries no date of any kind, so it can only ever be read as
  // "today", and only on a day there is a lunch to read.
  const todayIndex = osloWeekdayIndex();
  const todayKey = todayIndex >= 0 ? DAY_KEYS[todayIndex] : null;

  let dailyData: MenuData | null = null;
  if (todayKey) {
    const dailyResults = await scrapeAllDailyMenus(todayKey);
    for (const r of dailyResults) {
      if (r.error) {
        console.warn(`⚠️  ${r.canteen.displayName}: daily board unread — ${r.error}`);
      }
    }
    const built = buildDailyMenuData(dailyResults, todayKey);
    // A failed daily scrape is not a failed run. The board is an improvement on
    // the weekly menu, not a replacement for it: with nothing readable, the
    // week that was already going to be written is still written.
    if (Object.keys(built.canteens).length > 0) dailyData = built;
    else console.warn("⚠️  No daily board could be read — keeping the weekly menus as published.");
  } else {
    console.log("🛌 Weekend in Oslo — no daily board to read.");
  }

  // Proofread Norwegian dish titles (typos, compound words) before grouping & cache keys.
  const rawNoDishes = [
    ...new Set([
      ...extractNoDishes(menuData),
      ...(dailyData ? extractNoDishes(dailyData) : []),
    ]),
  ];
  try {
    const titleCorrections = await cleanDishTitles(rawNoDishes);
    if (Object.keys(titleCorrections).length > 0) {
      const updatedCount =
        applyTitleCorrections(menuData, titleCorrections) +
        (dailyData ? applyTitleCorrections(dailyData, titleCorrections) : 0);
      console.log(
        `✏️  Applied ${Object.keys(titleCorrections).length} Norwegian title correction(s) across ${updatedCount} dish item(s):`
      );
      for (const [orig, corr] of Object.entries(titleCorrections)) {
        console.log(`   "${orig}" → "${corr}"`);
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  Title proofreading failed: ${err?.message ?? err} — keeping raw titles.`);
  }

  // An explicit week id is a manual override ("rebuild 2026-W31"), so it wins
  // over whatever the canteens currently advertise.
  const groups = weekIdInput
    ? new Map([[weekIdInput, menuData.canteens || {}]])
    : groupCanteensByPublishedWeek(menuData, fallbackWeekId);

  // If every kitchen has flipped its weekly widget to next week, the loop below
  // would never visit the week the app is actually showing, and today's board
  // would have nowhere to land. Add that week with no scraped canteens of its
  // own: the merge then keeps whatever the row already holds, and the override
  // supplies today. Skipped for an explicit --week, which is a manual rebuild
  // of one named week and not a statement about today.
  if (dailyData && !weekIdInput && !groups.has(displayWeekId)) {
    console.log(
      `📌 Every canteen has published ahead — adding ${displayWeekId} so today's board has a row to land in.`
    );
    groups.set(displayWeekId, {});
  }

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
  const enrichmentRun: EnrichmentRun = { attempted: new Set() };

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

    // Only the week the app is showing gets today's board. Today is in exactly
    // one week, and this runs before extractAllDishes and fingerprintScrape so
    // the overridden dishes are enriched, fingerprinted and cached like any
    // other — not bolted on afterwards where nothing would look at them.
    if (dailyData && todayKey && weekId === displayWeekId) {
      const overridden = applyDailyOverride(weekMenuData, dailyData, todayKey);
      if (overridden.length > 0) {
        console.log(
          `🍽️  ${weekId} ${todayKey}: today's board overrode ${overridden.join(", ")}.`
        );
      }
    }

    const allDishes = extractAllDishes(weekMenuData);
    const fingerprint = fingerprintScrape(weekMenuData);
    const unchanged = !force && existing?.fingerprint === fingerprint;

    // Enrichment runs on every pass, not only when the menu changed.
    //
    // It used to be skipped whenever the fingerprint matched, which quietly
    // made the "will retry next run" message below a lie: a dish the model had
    // failed on was never asked about again for as long as the kitchens kept
    // publishing the same food, and users were served the pattern fallback all
    // week. Running it every time costs one dish_cache read when everything is
    // already cached — which is the normal case — because the model is only
    // asked about dishes that are genuinely missing a field.
    const enriched = await enrichDishes(
      allDishes,
      {
        origins: existing?.dishOrigins ?? {},
        descriptions: existing?.dishDescriptions ?? {},
      },
      enrichmentRun
    );
    const dishOrigins = enriched.origins;
    const dishDescriptions = enriched.descriptions;

    if (unchanged) {
      console.log(`✅ ${weekId} identical to the stored week — no new food to file.`);
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

    // Refreshing the cache is part of the write, not a nicety. getWeeklyMenuService
    // reads `menu:<weekId>` *before* it reads Supabase, so a stored row the cache
    // does not know about is a row nobody will ever be served.
    if (redis) {
      try {
        await redis.set(`menu:${weekId}`, record, { ex: MENU_CACHE_TTL_SECONDS });
        await redis.del(`response:menu:${weekId}`, "response:menu:current");
      } catch (err) {
        console.error("Redis menu write error:", err);
        console.warn(
          `⚠️  ${weekId} is stored but its cache entry was not replaced. The app will ` +
            `keep serving the previous copy for up to ${MENU_CACHE_TTL_SECONDS / 60} minutes.`
        );
      }
    } else {
      // The case that actually bit: a manual run from a machine whose .env has
      // the Supabase keys but no Redis ones. The database gets the new menu,
      // production keeps serving the old one out of a cache this run cannot
      // reach, and every check against the database says everything is fine.
      console.warn(
        `⚠️  ${weekId} was written to the database, but no Redis credentials are set ` +
          `here, so the cache the app reads first was not refreshed. Until it expires ` +
          `(${MENU_CACHE_TTL_SECONDS / 60} minutes) the deployed app keeps serving the ` +
          `previous menu. Set UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) ` +
          `to make a manual run take effect immediately.`
      );
    }

    writtenRecords.set(weekId, record);
    weeksWritten.push({
      weekId,
      canteens: Object.keys(scrapedCanteens),
      dishCount: allDishes.length,
      fromCache: enriched.fromCache,
      sentToModel: enriched.sentToModel,
      durablyCached: enriched.durablyCached,
      unresolved: enriched.unresolved,
      exhausted: enriched.exhausted,
      newlyExhausted: enriched.newlyExhausted,
      unchanged,
      menuData: weekMenuData,
    });

    console.log(
      `✅ ${weekId} stored — ${allDishes.length} dishes (${enriched.fromCache} cached, ` +
        `${enriched.sentToModel} asked, ${enriched.durablyCached} newly cached)` +
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
  //
  // The read-back deliberately bypasses the caches. getWeeklyMenuService would
  // answer from Redis, whose copy of this week can be up to seven days old, and
  // this record is what the image pass draws plates from — so a cache hit could
  // have the run illustrate a version of the week that no longer exists.
  const primary = weekIdInput
    ? writtenRecords.get(weekIdInput)!
    : writtenRecords.get(displayWeekId) ??
      (await readStoredRecord(displayWeekId)) ??
      writtenRecords.get([...writtenRecords.keys()].sort()[0])!;

  const primaryWrite = weeksWritten.find((w) => w.weekId === primary.weekId);
  const stats: UpdateStats = {
    weekId: primary.weekId,
    dishCount: primaryWrite?.dishCount ?? extractAllDishes(primary.menuData).length,
    fromCache: weeksWritten.reduce((n, w) => n + w.fromCache, 0),
    sentToModel: weeksWritten.reduce((n, w) => n + w.sentToModel, 0),
    durablyCached: weeksWritten.reduce((n, w) => n + w.durablyCached, 0),
    // Deduplicated: the two weeks of a rollover share most of their dishes, so
    // concatenating would double-count every dish that failed in both.
    unresolved: [...new Set(weeksWritten.flatMap((w) => w.unresolved))],
    exhausted: [...new Set(weeksWritten.flatMap((w) => w.exhausted))],
    newlyExhausted: [...new Set(weeksWritten.flatMap((w) => w.newlyExhausted))],
    failedCanteens: scrape.failed,
    // Scoped to the displayed week on purpose: it answers "is there anything to
    // regenerate downstream", and a week this run did not write has nothing.
    // Named for what it measures — as plain `unchanged` it read as a claim
    // about the whole run, which is false during a rollover.
    displayedWeekUnchanged: primaryWrite ? primaryWrite.unchanged : true,
  };

  if (scrape.failed.length) console.log(`⚠️  failed: ${scrape.failed.join(", ")}`);

  return { ...primary, stats, scrape, weeksWritten, weeksSkipped };
}

/**
 * Reads one week straight from the database, ignoring Redis.
 *
 * getWeeklyMenuService is the app's read and is right to prefer the cache. The
 * updater is not: it needs what is actually stored, both to decide what to
 * return and to hand the image pass something it can trust.
 */
async function readStoredRecord(weekId: string): Promise<WeeklyMenuRecord | null> {
  const supabase = getReadClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("weekly_menus")
    .select("week_id, menu_data, dish_origins, dish_descriptions, scraped_at")
    .eq("week_id", weekId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read back ${weekId}: ${error.message}`);
    return null;
  }
  if (!data?.menu_data) return null;

  return {
    weekId: data.week_id,
    menuData: data.menu_data,
    dishOrigins: data.dish_origins ?? {},
    dishDescriptions: data.dish_descriptions ?? {},
    scrapedAt: data.scraped_at,
  };
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

/** What the row already holds, so a fallback never overwrites a real answer. */
interface StoredEnrichment {
  origins: Record<string, DishOrigin>;
  descriptions: Record<string, DishDescription>;
}

/**
 * State shared by every week a single run writes.
 *
 * Both rows of a rollover contain nearly the same dishes — mergeCanteensForWeek
 * seeds every canteen into every week — so without this, one cron run asks the
 * model about a failing dish twice and charges it two of its five attempts. The
 * dishes that succeed are already protected: week A writes them to dish_cache
 * and week B reads them straight back.
 */
interface EnrichmentRun {
  attempted: Set<string>;
}

/**
 * Resolves an origin and description for every dish, using the cache first.
 *
 * Three rules, each of which cost something to learn:
 *
 * 1. **Per field.** The two passes are asked about different dish lists — only
 *    the dishes actually missing *that* field. They used to be asked the same
 *    list, and a dish was only cached when both came back, so a run where the
 *    origins landed and the descriptions timed out threw away a perfectly good
 *    origin and paid to ask for it again.
 * 2. **A fallback never wins over something real.** Both passes guarantee full
 *    coverage by filling gaps with canned copy, which is right for rendering
 *    and wrong for storing. The canned value is used only where neither the
 *    cache nor the stored row has anything better — otherwise a single bad
 *    afternoon at the model would rewrite the whole week as boilerplate and the
 *    fingerprint would then freeze it there.
 * 3. **Give up eventually.** A dish the model never answers for is re-asked on
 *    every run, forever, at no benefit. After MAX_ENRICH_ATTEMPTS it stops
 *    being sent and renders the fallback instead — recorded in `exhausted`, so
 *    it is a number someone can look at rather than a silent recurring cost.
 *    The fallback is still never written to dish_cache: a cache hit is
 *    permanent, and this decision has to stay reversible.
 */
async function enrichDishes(
  dishes: string[],
  stored: StoredEnrichment,
  run: EnrichmentRun
): Promise<{ origins: Record<string, DishOrigin>; descriptions: Record<string, DishDescription> } & EnrichmentCounts> {
  const { rows: cache, failed: cacheUnreadable } = await loadDishCache(dishes);
  const now = Date.now();

  // A cache we could not read is not a cache with nothing in it. Treating the
  // two the same would re-ask the model about an entire week that is already
  // fully answered, and record a failed attempt against every dish in it.
  // Reusing what the row already holds costs nothing and loses nothing; the
  // next run reads the cache again.
  if (cacheUnreadable) {
    console.warn("⚠️  dish_cache unreadable — reusing the stored enrichment and asking nothing.");
    const origins: Record<string, DishOrigin> = {};
    const descriptions: Record<string, DishDescription> = {};
    const unresolved: string[] = [];

    for (const dish of dishes) {
      const origin = stored.origins[dish];
      const description = stored.descriptions[dish];
      origins[dish] = origin ?? fallbackOrigin(dish);
      descriptions[dish] = description ?? fallbackDescription(dish);
      if (!origin || !description) unresolved.push(dish);
    }

    return {
      origins,
      descriptions,
      fromCache: 0,
      sentToModel: 0,
      durablyCached: 0,
      unresolved,
      exhausted: [],
      newlyExhausted: [],
    };
  }

  const origins: Record<string, DishOrigin> = {};
  const descriptions: Record<string, DishDescription> = {};
  const needOrigin: string[] = [];
  const needDescription: string[] = [];
  const givenUp: string[] = [];
  let fromCache = 0;

  for (const dish of dishes) {
    const hit = cache.get(normalizeDishName(dish));
    if (hit?.origin) origins[dish] = hit.origin;
    if (hit?.description) descriptions[dish] = hit.description;
    if (hit?.origin && hit?.description) {
      fromCache++;
      continue;
    }

    if (isEnrichmentExhausted(hit, now)) {
      givenUp.push(dish);
      continue;
    }
    // Already sent earlier in this same run, for the other week of a rollover.
    // The answer did not arrive then and will not arrive now; asking again just
    // doubles the bill and burns a second attempt on one run.
    if (run.attempted.has(dish)) continue;

    if (!hit?.origin) needOrigin.push(dish);
    if (!hit?.description) needDescription.push(dish);
  }

  const asked = new Set([...needOrigin, ...needDescription]);
  for (const dish of asked) run.attempted.add(dish);
  console.log(
    `🗃️  ${fromCache} dishes fully cached, ${asked.size} to ask about ` +
      `(${needOrigin.length} origins, ${needDescription.length} descriptions)` +
      (givenUp.length ? `, ${givenUp.length} given up on` : "") +
      "."
  );

  // detectDishOrigins/generateDishDescriptions short-circuit on an empty list,
  // so a fully-cached week costs no model call at all.
  const [newOrigins, newDescriptions] = await Promise.all([
    detectDishOrigins(needOrigin),
    generateDishDescriptions(needDescription),
  ]);

  for (const dish of needOrigin) {
    if (newOrigins.fromModel.has(dish)) origins[dish] = newOrigins.values[dish];
  }
  for (const dish of needDescription) {
    if (newDescriptions.fromModel.has(dish)) descriptions[dish] = newDescriptions.values[dish];
  }

  // `origins[dish]`/`descriptions[dish]` now hold only durable values — a cache
  // hit or a fresh model answer. Anything still blank gets the best available
  // stand-in, preferring what the row already holds over new boilerplate.
  const durableOrigins = new Set(Object.keys(origins));
  const durableDescriptions = new Set(Object.keys(descriptions));
  const unresolved: string[] = [];

  for (const dish of dishes) {
    if (!durableOrigins.has(dish)) origins[dish] = stored.origins[dish] ?? fallbackOrigin(dish);
    if (!durableDescriptions.has(dish)) {
      descriptions[dish] = stored.descriptions[dish] ?? fallbackDescription(dish);
    }
    if (!durableOrigins.has(dish) || !durableDescriptions.has(dish)) unresolved.push(dish);
  }

  const askedOrigin = new Set(needOrigin);
  const askedDescription = new Set(needDescription);
  const entries: DishCacheEntry[] = [];
  const newlyExhausted: string[] = [];
  let durablyCached = 0;

  for (const dish of asked) {
    const key = normalizeDishName(dish);
    const gainedOrigin = newOrigins.fromModel.has(dish);
    const gainedDescription = newDescriptions.fromModel.has(dish);
    const failed =
      (askedOrigin.has(dish) && !gainedOrigin) ||
      (askedDescription.has(dish) && !gainedDescription);

    if (gainedOrigin || gainedDescription) durablyCached++;

    const entry: DishCacheEntry = { cacheKey: key, originalName: dish };
    if (gainedOrigin) entry.origin = newOrigins.values[dish];
    if (gainedDescription) entry.description = newDescriptions.values[dish];

    if (failed) {
      const hit = cache.get(key);
      const attempts = activeEnrichAttempts(hit, now) + 1;
      entry.enrichAttempts = attempts;
      entry.lastEnrichAttempt = new Date(now).toISOString();
      if (attempts >= MAX_ENRICH_ATTEMPTS) newlyExhausted.push(dish);
    } else {
      // Fully answered — clear the counter so a dish that recovers is not one
      // bad run away from being given up on next time it goes missing.
      entry.enrichAttempts = 0;
      entry.lastEnrichAttempt = null;
    }

    entries.push(entry);
  }

  // Dishes already past the cap were never sent, so they carry no new attempt —
  // but they are still the thing an operator wants to see in the run report.
  const exhausted = [...newlyExhausted, ...givenUp];

  const saved = await saveDishCacheEntries(entries);
  console.log(
    `🗃️  ${saved} dish_cache rows written` +
      (unresolved.length ? `; ${unresolved.length} dish(es) still on a fallback` : "") +
      (exhausted.length ? `; ${exhausted.length} given up on after ${MAX_ENRICH_ATTEMPTS} tries` : "") +
      "."
  );

  return {
    origins,
    descriptions,
    fromCache,
    sentToModel: asked.size,
    durablyCached,
    unresolved,
    exhausted,
    newlyExhausted,
  };
}
