import { put } from "@vercel/blob";
import { getWeeklyMenu } from "../menu.js";

/** Where a week's published response lives; index.html builds the same path. */
export const staticMenuPath = (weekId: string) => `menu-response/${weekId}.json`;

/**
 * Writes the finished `/api/menu` response for each given week to Blob, one
 * static file per week.
 *
 * The page reads these instead of calling the function: a file has no cold
 * start (a CDN miss on /api/menu cost 2.7s measured), and naming it by week
 * means the page picks it from its own calendar, with nothing here deciding
 * "which week is current" at write time. A week with no stored row, or with no
 * canteens yet (a kitchen that has not published ahead), gets no file, and the
 * page falls back to /api/menu for it.
 *
 * 60s is Blob's minimum edge TTL, so a new menu lags the cron by at most that.
 * Returns the weeks it published.
 */
export async function publishStaticMenus(weekIds: Iterable<string>): Promise<string[]> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

  const published: string[] = [];
  for (const weekId of new Set(weekIds)) {
    let menu;
    try {
      menu = await getWeeklyMenu(weekId);
    } catch {
      continue; // nothing stored for that week
    }
    if (Object.keys(menu.menuData.canteens || {}).length === 0) continue;

    await put(staticMenuPath(weekId), JSON.stringify(menu), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
      token,
    });
    published.push(weekId);
  }
  return published;
}
