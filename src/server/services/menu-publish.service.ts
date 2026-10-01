import { put } from "@vercel/blob";
import { getWeeklyMenu } from "../menu.js";

/** Public path of the finished /api/menu response; index.html reads it on weekdays. */
export const STATIC_MENU_PATH = "menu-response/current.json";

/**
 * Writes the unpinned /api/menu response to Blob as a static file.
 *
 * A request that finds no CDN entry for /api/menu pays a cold function plus
 * Redis round trips (2.7s measured). This file has no function behind it, so
 * the first visitor never waits on one.
 *
 * Only the cron calls it, after the response cache was dropped, so getWeeklyMenu
 * rebuilds from the stored record. 60s is Blob's minimum edge TTL — the
 * shortest a new menu can lag behind a cron run.
 */
export async function publishStaticMenu(): Promise<string> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not set");

  const menu = await getWeeklyMenu();
  const blob = await put(STATIC_MENU_PATH, JSON.stringify(menu), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
    token,
  });
  return blob.url;
}
