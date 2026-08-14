import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getWeeklyMenu, MenuUnavailableError } from "../src/server/menu.ts";
import { methodNotAllowed, queryParam } from "./_lib/handler.ts";

/**
 * The menu the app renders. Reads stored data only — scraping and AI
 * enrichment belong to the cron job, not to a page view.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);

  try {
    const menu = await getWeeklyMenu(queryParam(req, "week"));

    // Menus change at most twice a day (see the cron schedule), so let the CDN
    // absorb the traffic and serve stale copies while it refreshes in the
    // background rather than hitting Supabase for every visitor.
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600");
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
