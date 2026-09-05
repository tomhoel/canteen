import type { MenuData, DishOrigin, DishDescription } from "../lib/types.js";
import {
  computeDisplayContext,
  getWeekId,
  getWeekIdOffset,
  isOsloWeekend,
} from "../lib/dateUtils.js";
import { DAY_KEYS } from "../lib/constants.js";
import { pickMainDish } from "../lib/dish-ranking.js";
import { getWeeklyMenuService, runWeeklyUpdateService } from "./services/menu.service.js";
import { loadDishCache, normalizeDishName } from "./services/dish-cache.service.js";
import { getRedis, menuResponseKey } from "./services/redis.service.js";

export interface WeeklyMenuResponse {
  /**
   * The week this response is actually for.
   *
   * Not always the week that was asked for: on a weekend the read path serves
   * next week's row, and a request with no week falls back to the most recent
   * stored one. The client needs to know which, or it has to guess from the
   * canteen labels inside the row — and those disagree with each other the
   * moment one kitchen has published ahead and another has not.
   */
  weekId: string;
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  /**
   * Storage path of the plate image for each canteen-day, keyed
   * `"<day>|<canteen name>"`. Absent means there is no picture for that day and
   * the card should render its placeholder.
   */
  plateImages: Record<string, string>;
  /**
   * The day the app will open on, e.g. `"monday"`, for a visit with no `?day=`
   * or `?week=`.
   *
   * Exists for the plate preloading in index.html's head script, which has to
   * name the three above-the-fold pictures before any bundle has run. It used
   * to work this out itself, and could not: on a weekend the landing day
   * depends on whether the served week is ahead of the current one, which is
   * exactly the question that needs `weekId` and the week-comparison rules in
   * dateUtils. So it warmed *both* Monday and Friday — six pictures, three of
   * them thrown away, 54 KB measured.
   *
   * Sending the answer keeps that decision in `computeDisplayContext` with the
   * rest of it, instead of a second implementation of Oslo weekday resolution
   * living in an inline script with no tests. Purely a hint: the head script
   * falls back to its own guess if this is absent, and nothing else reads it.
   */
  landingDay: string;
}

/**
 * The dish names the cards can actually look up.
 *
 * `dishOrigins` and `dishDescriptions` are stored for every dish of every day —
 * mains and sides, both languages — but exactly one place reads them, and it
 * reads them by one key per canteen-day: HomeClient.tsx looks up
 * `lookupMainDish.dish`, which is the Norwegian ranked main when it has a name
 * and the English one when it does not. Sides are never asked about. On the
 * live payload that is 14 keys out of 87, and the two maps are ~58% of the
 * response.
 *
 * This deliberately does NOT reuse the key set `resolvePlateImages` builds,
 * even though it looks like the same thing. That one takes
 * `no.items?.length ? no.items : en.items` and then skips the day entirely if
 * the winner has a blank name — where the card falls through to the English
 * main instead. The sets are a subset relation, not an identity, and trimming
 * to the smaller one would drop a description the card still wants.
 *
 * Both mains are kept rather than only the one the rule selects. The extra
 * entry per canteen-day is a few hundred bytes and it means a future change to
 * the client's fallback cannot silently start missing data.
 */
function reachableDishNames(menuData: MenuData): Set<string> {
  const names = new Set<string>();

  for (const [canteenName, canteen] of Object.entries(menuData.canteens || {})) {
    for (const dayItem of canteen.menu || []) {
      for (const items of [dayItem.no?.items, dayItem.en?.items]) {
        const main = pickMainDish(items, canteenName)?.dish?.trim();
        if (main) names.add(main);
      }
    }
  }

  return names;
}

/** Keeps only the entries `reachableDishNames` says a card can ask for. */
function pickReachable<T>(
  map: Record<string, T> | undefined,
  names: Set<string>
): Record<string, T> {
  if (!map) return {};
  const out: Record<string, T> = {};
  for (const name of names) {
    if (name in map) out[name] = map[name];
  }
  return out;
}

/** Raised when no menu could be served, so the endpoint can answer 503. */
export class MenuUnavailableError extends Error {}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/** The key both sides agree on. Canteen *name*, not slug: slugs can drift. */
function plateKey(dayKey: string, canteenName: string): string {
  return `${dayKey}|${canteenName}`;
}

/**
 * Resolves which stored image belongs to each card.
 *
 * The client used to build this path itself as `<day>/<canteen>.png` — a slot
 * with no week in it, so only one week's plates can exist at a time and any
 * other week's cards showed the wrong food. The server already knows better:
 * `dish_cache.image_nobg_path` addresses a plate by the dish it depicts, which
 * is stable across every week that dish appears in.
 *
 * Resolved at read time rather than when the row is written, because the cron
 * stores the menu before it generates any images and the record is cached for
 * days afterwards — a map built at write time would be missing exactly the
 * plates that run went on to draw.
 *
 * The per-day slot remains the fallback, but only for the calendar week. For
 * any other week that slot holds a different week's food, and a card with no
 * picture is better than a card with the wrong one.
 */
async function resolvePlateImages(
  menuData: MenuData,
  weekId: string
): Promise<Record<string, string>> {
  const slotsApply = weekId === getWeekId();
  const targets: Array<{ key: string; dish: string; slotPath: string }> = [];

  for (const [canteenName, canteen] of Object.entries(menuData.canteens || {})) {
    const slug = canteenName.toLowerCase().replace(/\s+/g, "_");

    for (const dayItem of canteen.menu || []) {
      const dayKey = dayItem.day.toLowerCase();
      if (!DAY_ORDER.includes(dayKey)) continue;

      const items = dayItem.no?.items?.length ? dayItem.no.items : dayItem.en?.items;
      // The same ranking the card uses to choose its title, so the picture and
      // the name can never come from different dishes.
      const mainDish = pickMainDish(items, canteenName);
      if (!mainDish?.dish?.trim()) continue;

      targets.push({
        key: plateKey(dayKey, canteenName),
        dish: mainDish.dish.trim(),
        slotPath: `${dayKey}/${slug}.png`,
      });
    }
  }

  if (targets.length === 0) return {};

  // A failed cache read must not strip every card of its picture, so fall back
  // to the slots exactly as the client used to.
  const { rows, failed } = await loadDishCache(targets.map((t) => t.dish));
  if (failed) console.warn("dish_cache unreadable — plate images fall back to the weekly slots.");

  const plateImages: Record<string, string> = {};
  for (const target of targets) {
    const archived = rows.get(normalizeDishName(target.dish))?.imageNoBgPath;
    const path = archived ?? (slotsApply ? target.slotPath : undefined);
    if (path) plateImages[target.key] = path;
  }

  return plateImages;
}

/**
 * Reads the stored menu for the app.
 *
 * This used to swallow every failure and return a hardcoded INITIAL_MENU_DATA
 * stub instead — which made a completely broken data pipeline look like a
 * working app serving a strangely empty week. A failure here is now visible:
 * the route renders its error state and the log says why.
 */
/**
 * Which stored week an unpinned request should be answered with.
 *
 * On a weekday, this week. From Saturday, next week if it has been published —
 * that is what puts the app into `weekend-preview`, and it had quietly stopped
 * being possible.
 *
 * The mode is chosen on the client, by `allCanteensAhead`, from the week each
 * canteen's own label claims. That test used to pass by accident: before the
 * week-routing fix (0c0be3d) the updater wrote every canteen into the row keyed
 * by the *current* week regardless of what they published, so after the
 * kitchens rolled over, this week's row physically contained next-week labels.
 * Routing each canteen to the week it actually publishes was the right fix for
 * a real data bug — next week's menus were overwriting this week's — but it
 * removed the only way the preview condition could ever be true. Every row now
 * holds labels matching its own week, so a weekend request for this week can
 * only ever produce `weekend-recap`.
 *
 * Handing back next week's row restores it with no client change at all: the
 * labels read `[34, 34, 34]` against a current week of 33, `allCanteensAhead`
 * is true, and the UI shifts the dates, lands on Monday, hides voting and shows
 * its preview banner exactly as it was written to.
 *
 * A canteen that has not published yet is simply absent from that row, which is
 * honest — it is the same reason the row is trustworthy. The banner names them
 * so a missing card reads as "not out yet" rather than as a bug.
 */
async function readWeekForDisplay(weekId?: string) {
  // An explicitly requested week is never second-guessed.
  if (weekId) return await getWeeklyMenuService(weekId);

  if (isOsloWeekend()) {
    const ahead = await getWeeklyMenuService(getWeekIdOffset(1));
    // An empty or missing row means the kitchens have not published yet; fall
    // through to the week that just ended rather than showing a blank app.
    if (Object.keys(ahead?.menuData?.canteens ?? {}).length > 0) return ahead;
  }

  return await getWeeklyMenuService();
}

let memoryCache: { key: string; data: WeeklyMenuResponse; expires: number } | null = null;

export function clearMenuMemoryCache() {
  memoryCache = null;
}

export async function getWeeklyMenu(weekId?: string): Promise<WeeklyMenuResponse> {
  const cacheKey = weekId || "current";
  const now = Date.now();

  const isProd = Boolean(process.env.VERCEL || process.env.NODE_ENV === "production");

  if (isProd && memoryCache && memoryCache.key === cacheKey && memoryCache.expires > now) {
    return memoryCache.data;
  }

  const redis = isProd ? getRedis() : null;
  if (redis) {
    try {
      const redisCached = await redis.get<WeeklyMenuResponse>(menuResponseKey(weekId));
      if (redisCached && redisCached.menuData) {
        memoryCache = { key: cacheKey, data: redisCached, expires: now + 5 * 60 * 1000 };
        return redisCached;
      }
    } catch (err) {
      console.warn("Redis menu response cache read failed:", err);
    }
  }

  const record = await readWeekForDisplay(weekId);

  if (!record?.menuData) {
    throw new MenuUnavailableError(
      weekId
        ? `No menu stored for ${weekId}.`
        : "No menu data available yet — the weekly update has not populated this week."
    );
  }

  const reachable = reachableDishNames(record.menuData);

  const result: WeeklyMenuResponse = {
    weekId: record.weekId,
    menuData: record.menuData,
    dishOrigins: pickReachable(record.dishOrigins, reachable),
    dishDescriptions: pickReachable(record.dishDescriptions, reachable),
    // Keyed off the week that was actually served, which is not always the one
    // that was asked for: the read falls back to the most recent stored week.
    plateImages: await resolvePlateImages(record.menuData, record.weekId),
    // No canteen week numbers and no pinned week: with `servedWeekId` given,
    // computeDisplayContext needs neither, and passing the labels would
    // reintroduce the disagreement `servedWeekId` was added to settle.
    // `?? DAY_KEYS[0]` is unreachable — defaultSelectedDay is only ever 0..4,
    // unlike todayIndex which is -1 at the weekend — but a hint is not worth
    // an undefined leaking into the preload URLs if that ever changes.
    landingDay:
      DAY_KEYS[computeDisplayContext([], undefined, record.weekId).defaultSelectedDay] ??
      DAY_KEYS[0],
  };

  if (isProd) {
    // Keep in serverless instance memory for 5 minutes
    memoryCache = { key: cacheKey, data: result, expires: now + 5 * 60 * 1000 };
    if (redis) {
      try {
        await redis.set(menuResponseKey(weekId), result, { ex: 10 * 60 });
      } catch (err) {
        console.warn("Redis menu response cache write failed:", err);
      }
    }
  }

  return result;
}

export { runWeeklyUpdateService };
