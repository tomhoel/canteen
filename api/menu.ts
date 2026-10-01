import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getWeeklyMenu, MenuUnavailableError } from "../src/server/menu.js";
import { methodNotAllowed, queryParam } from "./_lib/handler.js";

/**
 * The menu the app renders. Reads stored data only — scraping and AI
 * enrichment belong to the cron job, not to a page view.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const menu = await getWeeklyMenu(queryParam(req, "week"));

    // This is the fallback path: the page reads the per-week files the updater
    // publishes to Blob (menu-response/<week>.json) and only comes here when one
    // is missing, or for a ?week= it has no file for. Short caching, so a fresh
    // update is never hidden behind a CDN copy for long.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    return res.status(200).json(menu);
  } catch (err: any) {
    if (err instanceof MenuUnavailableError) {
      // Don't let the CDN cache an outage.
      res.setHeader("Cache-Control", "no-store");
      console.warn("Menu unavailable:", err.message);
      return res.status(503).json({ error: err.message });
    }

    console.error("Menu endpoint failed:", err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).json({ error: err?.message ?? "Unexpected error" });
  }
}
