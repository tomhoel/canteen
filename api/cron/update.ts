import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runWeeklyUpdateService } from "../../src/server/services/menu.service";
import { processAllCanteenAIImages } from "../../src/server/services/image.service";
import { sendCronAlert } from "../../src/server/notify";

/**
 * The weekly updater. This is the only thing that writes menu data.
 *
 * It used to live in a GitHub Actions workflow, but scheduled workflows are
 * disabled automatically after 60 days without repository activity — and this
 * repo intentionally gets no commits, because the menu lives in Supabase
 * rather than in git. Vercel Cron has no such rule.
 *
 * Scheduled from vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`
 * on every cron invocation once that variable is set on the project.
 */

/** Total function budget, mirrored from vercel.json's maxDuration. */
const MAX_DURATION_MS = 300_000;

/** Head-room left for the response and cleanup after image work stops. */
const SAFETY_MARGIN_MS = 20_000;

type AuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Fails closed. An earlier version accepted any request carrying the
 * `x-vercel-cron` header when CRON_SECRET was unset — but that header is just
 * a request header, so anyone could set it and trigger an unbounded run of
 * paid image generation. The secret is now mandatory.
 */
function authorize(req: VercelRequest): AuthResult {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return {
      ok: false,
      status: 503,
      error:
        "CRON_SECRET is not configured on this deployment, so cron requests cannot be " +
        "authenticated. Set it in the Vercel project settings; Vercel then sends it " +
        "automatically on scheduled invocations.",
    };
  }

  if (req.headers["authorization"] !== `Bearer ${secret}`) {
    return { ok: false, status: 401, error: "Unauthorized cron trigger" };
  }

  return { ok: true };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = authorize(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const startedAt = Date.now();

  // `?force=1` re-asks the model for every dish and rebuilds every plate
  // instead of reusing the dish cache — the job the manual force-regen
  // workflow used to do. Never set by the scheduler.
  const force = req.query?.force === "1" || req.query?.force === "true";

  console.log(`🚀 [cron] Weekly menu update starting${force ? " (force)" : ""}...`);

  let record;
  try {
    record = await runWeeklyUpdateService(undefined, { force });
  } catch (error: any) {
    // A failed scrape or a rejected write must surface as a 500 so it shows up
    // in Vercel's cron run history, and as a Slack alert so someone notices
    // before staff do.
    console.error("❌ [cron] Menu update failed:", error);
    await sendCronAlert("error", "Weekly menu update failed", [
      error.message,
      "The stored menu was left untouched.",
    ]);
    return res.status(500).json({ error: "Menu update failed", details: error.message });
  }

  // A partial scrape still persists — one canteen being down should not cost
  // us the other two — but it is worth hearing about.
  if (record.stats.failedCanteens.length > 0) {
    await sendCronAlert("warning", "Some canteens could not be scraped", [
      `Failed: ${record.stats.failedCanteens.join(", ")}`,
      `Stored ${record.stats.dishCount} dishes for ${record.weekId} from the rest.`,
    ]);
  }

  // Images are best-effort: the menu itself is already safely stored, and a
  // missing plate photo is far less bad than a missing menu.
  let images = null;
  let imageError: string | null = null;
  try {
    const elapsed = Date.now() - startedAt;
    const budgetMs = Math.max(0, MAX_DURATION_MS - elapsed - SAFETY_MARGIN_MS);
    images = await processAllCanteenAIImages(record.menuData, { budgetMs, force });
  } catch (err: any) {
    imageError = err.message;
    console.warn("⚠️ [cron] Image processing failed:", err.message);
    await sendCronAlert("warning", "Dish images could not be processed", [
      err.message,
      `The menu for ${record.weekId} was stored successfully.`,
    ]);
  }

  return res.status(200).json({
    status: "success",
    weekId: record.weekId,
    unchanged: record.stats.unchanged,
    canteens: Object.keys(record.menuData.canteens || {}).length,
    dishes: record.stats.dishCount,
    dishesFromCache: record.stats.fromCache,
    dishesGenerated: record.stats.generated,
    failedCanteens: record.stats.failedCanteens,
    images,
    imageError,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
