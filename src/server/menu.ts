import type { MenuData, DishOrigin, DishDescription } from "../lib/types.js";
import { getWeekId } from "../lib/dateUtils.js";
import { pickMainDish } from "../lib/dish-ranking.js";
import { getWeeklyMenuService, runWeeklyUpdateService } from "./services/menu.service.js";
import { loadDishCache, normalizeDishName } from "./services/dish-cache.service.js";

export interface WeeklyMenuResponse {
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  /**
   * Storage path of the plate image for each canteen-day, keyed
   * `"<day>|<canteen name>"`. Absent means there is no picture for that day and
   * the card should render its placeholder.
   */
  plateImages: Record<string, string>;
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
export async function getWeeklyMenu(weekId?: string): Promise<WeeklyMenuResponse> {
  const record = await getWeeklyMenuService(weekId);

  if (!record?.menuData) {
    throw new MenuUnavailableError(
      weekId
        ? `No menu stored for ${weekId}.`
        : "No menu data available yet — the weekly update has not populated this week."
    );
  }

  return {
    menuData: record.menuData,
    dishOrigins: record.dishOrigins || {},
    dishDescriptions: record.dishDescriptions || {},
    // Keyed off the week that was actually served, which is not always the one
    // that was asked for: the read falls back to the most recent stored week.
    plateImages: await resolvePlateImages(record.menuData, record.weekId),
  };
}

export { runWeeklyUpdateService };
