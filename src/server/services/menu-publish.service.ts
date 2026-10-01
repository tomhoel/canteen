import { createHash } from "node:crypto";
import { getWeeklyMenu } from "../menu.js";
import { getRedis } from "./redis.service.js";
import { putObject } from "./storage.service.js";

/** Redis hash: week id -> hash of the file last written for it. */
const HASH_KEY = "static_menu_hash";

/**
 * Writes the finished `/api/menu` response for each given week to storage, one
 * static file per week.
 *
 * The page reads these instead of calling the function: a file has no cold
 * start (a CDN miss on /api/menu cost 2.7s measured), and naming it by week
 * means the page picks it from its own calendar, with nothing here deciding
 * "which week is current" at write time. A week with no stored row, or with no
 * canteens yet (a kitchen that has not published ahead), gets no file, and the
 * page falls back to /api/menu for it.
 *
 * Cached for 60s, so a new menu lags the cron by at most that.
 *
 * A file whose content has not changed is not written again (its hash is kept in
 * Redis): the cron runs 11 times a week and the menu changes a handful of times,
 * and on the free plan every upload counts against a monthly allowance whose
 * overrun suspends the store, plates included. `scrapedAt` is left out of the
 * hash because it changes on every scrape and nothing reads it.
 * Returns the weeks it wrote.
 */
export async function publishStaticMenus(weekIds: Iterable<string>): Promise<string[]> {
  const published: string[] = [];
  for (const weekId of new Set(weekIds)) {
    let menu;
    try {
      menu = await getWeeklyMenu(weekId);
    } catch {
      continue; // nothing stored for that week
    }
    if (Object.keys(menu.menuData.canteens || {}).length === 0) continue;

    const body = JSON.stringify(menu);
    const hash = createHash("sha256")
      .update(JSON.stringify({ ...menu, menuData: { ...menu.menuData, scrapedAt: "" } }))
      .digest("hex");
    const redis = getRedis();
    if (redis && (await redis.hget<string>(HASH_KEY, weekId).catch(() => null)) === hash) continue;

    // Bucket "menu-response", object "<week>.json"; index.html builds the same URL.
    await putObject("menu-response", `${weekId}.json`, body, "application/json", 60);
    await redis?.hset(HASH_KEY, { [weekId]: hash }).catch(() => undefined);
    published.push(weekId);
  }
  return published;
}
