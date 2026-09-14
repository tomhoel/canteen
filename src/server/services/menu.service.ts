import { createHash } from "node:crypto";
import { getRedis, menuResponseKey } from "./redis.service.js";
import type {
  MenuData,
  DayEntry,
  MenuItem,
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
  shortenDishTitles,
  needsShortening,
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
 * Words worth comparing. Short ones ("med", "og", "i") match everything.
 */
function significantWords(dish: string): Set<string> {
  return new Set(
    dish
      .toLowerCase()
      .replace(/[0-9]/g, " ")
      .replace(/[^a-zæøåäöü ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

/** How much of the shorter dish name the two have in common, 0..1. */
function dishSimilarity(a: string, b: string): number {
  const A = significantWords(a);
  const B = significantWords(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / Math.min(A.size, B.size);
}

/** Average over the board's dishes of the best match in a day's menu. */
function dayMatch(board: MenuItem[], day: MenuItem[]): number {
  if (board.length === 0 || day.length === 0) return 0;
  const best = board.map((b) => Math.max(0, ...day.map((d) => dishSimilarity(b.dish, d.dish))));
  return best.reduce((a, b) => a + b, 0) / best.length;
}

/**
 * How well the board must match tomorrow before we believe it has rolled over,
 * and by how much it must beat today.
 *
 * Measured against the two real boards Fresh4you published on 2026-09-07 — the
 * same board, the same day, eight hours apart:
 *
 *   showing today's food     today 0.87   tomorrow 0.00
 *   rolled to tomorrow's     today 0.00   tomorrow 0.62
 *
 * The gap is wide enough that these thresholds are not a fine-tuning exercise;
 * they sit in the middle of an empty range. Both conditions have to hold, so a
 * week whose weekly menu is simply wrong — which is the case the override
 * exists for — scores low against BOTH days and is left alone.
 */
const ROLLOVER_MIN_MATCH = 0.4;
const ROLLOVER_MIN_MARGIN = 0.3;

/**
 * Whether a daily board is showing the NEXT day's food.
 *
 * The board carries no date of any kind — it is just "DAGENS LUNSJ" and three
 * dishes — so the only way to date it is to ask which weekday's menu it looks
 * like. Kitchens roll it forward during the afternoon, and a scrape that
 * happens after they do writes tomorrow's food into today's slot.
 *
 * Deliberately asymmetric: this does NOT require the board to match today. The
 * whole reason `applyDailyOverride` exists is that the weekly menu can be a
 * draft nobody cooked, so demanding a match with today would defeat it. It only
 * fires when the board matches TOMORROW clearly better.
 */
export function boardLooksLikeNextDay(
  board: MenuItem[],
  today: MenuItem[],
  tomorrow: MenuItem[]
): boolean {
  if (board.length === 0 || tomorrow.length === 0) return false;
  const matchTomorrow = dayMatch(board, tomorrow);
  if (matchTomorrow < ROLLOVER_MIN_MATCH) return false;
  return matchTomorrow - dayMatch(board, today) >= ROLLOVER_MIN_MARGIN;
}

/** The items a day entry published, in whichever language it filled in. */
function itemsOf(entry: DayEntry | undefined): MenuItem[] {
  return entry?.no?.items ?? entry?.en?.items ?? [];
}

/**
 * Replaces today's slot with what the kitchen actually served.
 *
 * Returns the canteens it changed and the ones it refused to change because
 * their board had already rolled over to tomorrow, both for the log.
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
): { overridden: string[]; rolledOver: string[] } {
  const overridden: string[] = [];
  const rolledOver: string[] = [];

  // Tomorrow within the same week. Friday has none, so the guard below cannot
  // fire then — a Friday-evening board showing Monday's food would still get
  // through. Left as is: the scheduled runs are at 06:00 and 09:00, and
  // inventing a cross-week comparison to cover a case only a manual run can
  // reach would be more machinery than the risk deserves.
  const tomorrowKey = DAY_KEYS[DAY_KEYS.indexOf(todayKey) + 1];

  for (const [name, dailyCanteen] of Object.entries(daily.canteens || {})) {
    const target = weekMenuData.canteens?.[name];
    if (!target) continue;

    const source = dailyCanteen.menu?.[0];
    if (!source || (!source.no && !source.en)) continue;

    const menu = [...(target.menu ?? [])];
    const index = menu.findIndex((d) => d.day?.toLowerCase() === todayKey);
    const existing = index >= 0 ? menu[index] : undefined;

    // Per canteen, not per run: kitchens roll their boards over at different
    // times, and one that has is no reason to distrust the other two.
    if (tomorrowKey) {
      const tomorrow = menu.find((d) => d.day?.toLowerCase() === tomorrowKey);
      if (boardLooksLikeNextDay(itemsOf(source), itemsOf(existing), itemsOf(tomorrow))) {
        rolledOver.push(name);
        continue;
      }
    }

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

  return { overridden, rolledOver };
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
 * Drops the cached `/api/menu` responses for these weeks.
 *
 * The write loop already does this when it stores a week — but plate images are
 * drawn *after* the write, by a separate pass in the updater, and a response
 * cached in between is one with the menu and without the pictures. Left alone
 * it is served until the TTL expires, which is exactly long enough to make a
 * freshly-illustrated week look broken to whoever just ran the update.
 *
 * Only clears this app's own caches. The CDN in front of them has its own
 * `s-maxage` and `stale-while-revalidate`, which nothing here can purge; that
 * layer catches up on its own.
 */
export async function invalidateMenuResponseCache(weekIds: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  const keys = [menuResponseKey(), ...weekIds.map((id) => menuResponseKey(id))];
  try {
    await redis.del(...keys);
  } catch (err) {
    console.warn(`⚠️  Could not drop cached menu responses: ${(err as Error).message}`);
  }
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
      const { overridden, rolledOver } = applyDailyOverride(weekMenuData, dailyData, todayKey);
      if (overridden.length > 0) {
        console.log(
          `🍽️  ${weekId} ${todayKey}: today's board overrode ${overridden.join(", ")}.`
        );
      }
      if (rolledOver.length > 0) {
        console.warn(
          `⏭️  ${weekId} ${todayKey}: ${rolledOver.join(", ")} already rolled the board ` +
            `to tomorrow — kept the weekly menu rather than writing the wrong day's food.`
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
        shortNames: existing?.dishShortNames ?? {},
      },
      enrichmentRun
    );
    const dishOrigins = enriched.origins;
    const dishDescriptions = enriched.descriptions;
    const dishShortNames = enriched.shortNames;

    if (unchanged) {
      console.log(`✅ ${weekId} identical to the stored week — no new food to file.`);
    }

    const record: WeeklyMenuRecord = {
      weekId,
      menuData: weekMenuData,
      dishOrigins,
      dishDescriptions,
      dishShortNames,
      scrapedAt,
    };

    if (!redis) {
      throw new PartialUpdateError(
        `Redis is not configured — cannot persist ${weekId}`,
        [...weeksWritten]
      );
    }

    try {
      await redis.set(`menu:${weekId}`, {
        ...record,
        menuData: { ...weekMenuData, fingerprint },
      });
      const match = weekId.match(/^(\d{4})-W(\d{1,2})$/);
      const score = match ? parseInt(match[1], 10) * 100 + parseInt(match[2], 10) : 0;
      await redis.zadd("menu:weeks", { score, member: weekId });
      await redis.del(menuResponseKey(weekId), menuResponseKey());
    } catch (err: any) {
      throw new PartialUpdateError(
        `Redis write failed for ${weekId}: ${err?.message ?? err}`,
        [...weeksWritten]
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
  const redis = getRedis();
  if (!redis) return null;

  try {
    const data = await redis.get<any>(`menu:${weekId}`);
    if (!data?.menuData) return null;

    return {
      weekId: data.weekId ?? weekId,
      menuData: data.menuData,
      dishOrigins: data.dishOrigins ?? {},
      dishDescriptions: data.dishDescriptions ?? {},
      dishShortNames: data.dishShortNames ?? {},
      scrapedAt: data.scrapedAt ?? new Date().toISOString(),
    };
  } catch (err: any) {
    console.error(`Could not read back ${weekId}: ${err?.message ?? err}`);
    return null;
  }
}

interface StoredRow {
  fingerprint?: string;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  dishShortNames: Record<string, string>;
  /** The stored week, so a partial scrape can be merged into it. */
  menuData: MenuData | null;
}

/**
 * Reads the stored row for a week from Redis, including the embedded fingerprint.
 */
async function getStoredRow(
  weekId: string
): Promise<{ ok: true; row: StoredRow | null } | { ok: false; error: string }> {
  const redis = getRedis();
  if (!redis) return { ok: false, error: "Redis is not configured" };

  try {
    const data = await redis.get<any>(`menu:${weekId}`);
    if (!data) return { ok: true, row: null };

    return {
      ok: true,
      row: {
        fingerprint: data.menuData?.fingerprint,
        dishOrigins: data.dishOrigins ?? {},
        dishDescriptions: data.dishDescriptions ?? {},
        dishShortNames: data.dishShortNames ?? {},
        menuData: (data.menuData as MenuData) ?? null,
      },
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** What the row already holds, so a fallback never overwrites a real answer. */
interface StoredEnrichment {
  origins: Record<string, DishOrigin>;
  descriptions: Record<string, DishDescription>;
  shortNames: Record<string, string>;
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
): Promise<{
  origins: Record<string, DishOrigin>;
  descriptions: Record<string, DishDescription>;
  shortNames: Record<string, string>;
} & EnrichmentCounts> {
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
      // Whatever the row already holds. There is no fallback for a short title
      // — a dish without one renders its full name, which is correct.
      shortNames: { ...stored.shortNames },
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
  const shortNames: Record<string, string> = {};
  const needOrigin: string[] = [];
  const needDescription: string[] = [];
  const needShortName: string[] = [];
  const givenUp: string[] = [];
  let fromCache = 0;

  for (const dish of dishes) {
    const hit = cache.get(normalizeDishName(dish));
    if (hit?.origin) origins[dish] = hit.origin;
    if (hit?.description) descriptions[dish] = hit.description;
    if (hit?.shortName) shortNames[dish] = hit.shortName;

    // A short title is only wanted for a name too long for the card, and is
    // only ever asked for once: any stored value settles it, including the
    // "could not be shortened" marker written further down.
    const wantsShortName = needsShortening(dish) && !hit?.shortName;

    if (hit?.origin && hit?.description && !wantsShortName) {
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
    if (wantsShortName) needShortName.push(dish);
  }

  const asked = new Set([...needOrigin, ...needDescription, ...needShortName]);
  for (const dish of asked) run.attempted.add(dish);
  console.log(
    `🗃️  ${fromCache} dishes fully cached, ${asked.size} to ask about ` +
      `(${needOrigin.length} origins, ${needDescription.length} descriptions, ` +
      `${needShortName.length} long titles)` +
      (givenUp.length ? `, ${givenUp.length} given up on` : "") +
      "."
  );

  // detectDishOrigins/generateDishDescriptions short-circuit on an empty list,
  // so a fully-cached week costs no model call at all.
  const [newOrigins, newDescriptions, newShortNames] = await Promise.all([
    detectDishOrigins(needOrigin),
    generateDishDescriptions(needDescription),
    shortenDishTitles(needShortName),
  ]);

  for (const dish of needOrigin) {
    if (newOrigins.fromModel.has(dish)) origins[dish] = newOrigins.values[dish];
  }
  for (const dish of needDescription) {
    if (newDescriptions.fromModel.has(dish)) descriptions[dish] = newDescriptions.values[dish];
  }
  for (const dish of needShortName) {
    if (newShortNames.fromModel.has(dish)) shortNames[dish] = newShortNames.values[dish];
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
    // No fallback: a dish with no short title renders its full name. Only the
    // stored row can supply one this run did not get.
    if (!shortNames[dish] && stored.shortNames[dish]) {
      shortNames[dish] = stored.shortNames[dish];
    }
    if (!durableOrigins.has(dish) || !durableDescriptions.has(dish)) unresolved.push(dish);
  }

  const askedOrigin = new Set(needOrigin);
  const askedDescription = new Set(needDescription);
  const askedShortName = new Set(needShortName);
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

    if (gainedOrigin || gainedDescription || newShortNames.fromModel.has(dish)) {
      durablyCached++;
    }

    const entry: DishCacheEntry = { cacheKey: key, originalName: dish };
    if (gainedOrigin) entry.origin = newOrigins.values[dish];
    if (gainedDescription) entry.description = newDescriptions.values[dish];

    // A title the model looked at and declined to shorten is stored as itself.
    // That is the "asked, and nothing better exists" marker: it renders as the
    // full name, which is what would have happened anyway, and it stops the
    // dish being re-sent on every run forever. Written only when the model
    // actually answered for that batch — a rate-limited call has to stay
    // retryable, and `answered` is what tells a decline apart from a call that
    // never landed.
    if (newShortNames.fromModel.has(dish)) {
      entry.shortName = newShortNames.values[dish];
    } else if (askedShortName.has(dish) && newShortNames.answered.has(dish)) {
      entry.shortName = dish;
    }

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
    shortNames,
    fromCache,
    sentToModel: asked.size,
    durablyCached,
    unresolved,
    exhausted,
    newlyExhausted,
  };
}
