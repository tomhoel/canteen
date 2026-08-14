import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runWeeklyUpdateService } from "../../src/server/services/menu.service.ts";
import { processAllCanteenAIImages } from "../../src/server/services/image.service.ts";

/**
 * The weekly updater. This is the only thing that writes menu data.
 *
 * It used to live in a GitHub Actions workflow, but scheduled workflows are
 * disabled automatically after 60 days without repository activity — and this
 * repo intentionally gets no commits, because the menu lives in Supabase
 * rather than in git. Vercel Cron has no such rule.
 *
 * Scheduled from vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * when that variable is set on the project.
 */

/** Total function budget, mirrored from vercel.json's maxDuration. */
const MAX_DURATION_MS = 300_000;

/** Head-room left for the response and cleanup after image work stops. */
const SAFETY_MARGIN_MS = 20_000;

function isAuthorized(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;

  // Without a secret configured we cannot authenticate, so only accept
  // Vercel's own scheduler, which stamps this header on cron invocations.
  if (!secret) return req.headers["x-vercel-cron"] !== undefined;

  return req.headers["authorization"] === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "Unauthorized cron trigger" });
  }

  const startedAt = Date.now();
  console.log("🚀 [cron] Starting weekly menu scrape & AI processing...");

  let record;
  try {
    record = await runWeeklyUpdateService();
  } catch (error: any) {
    // A failed scrape or a rejected write must surface as a 500 so it shows up
    // in Vercel's cron run history rather than passing silently.
    console.error("❌ [cron] Menu update failed:", error);
    return res.status(500).json({ error: "Menu update failed", details: error.message });
  }

  // Images are best-effort: the menu itself is already safely stored, and a
  // missing plate photo is far less bad than a missing menu.
  // `?force=1` rebuilds every plate instead of reusing archived ones — the
  // job the manual force-regen-images workflow used to do. Only reachable
  // with the cron secret, and never set by the scheduler itself.
  const force = req.query?.force === "1" || req.query?.force === "true";

  let images = null;
  let imageError: string | null = null;
  try {
    const elapsed = Date.now() - startedAt;
    const budgetMs = Math.max(0, MAX_DURATION_MS - elapsed - SAFETY_MARGIN_MS);
    images = await processAllCanteenAIImages(record.menuData, { budgetMs, force });
  } catch (err: any) {
    imageError = err.message;
    console.warn("⚠️ [cron] Image processing failed:", err.message);
  }

  return res.status(200).json({
    status: "success",
    weekId: record.weekId,
    canteens: Object.keys(record.menuData.canteens || {}).length,
    dishes: Object.keys(record.dishOrigins || {}).length,
    images,
    imageError,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
