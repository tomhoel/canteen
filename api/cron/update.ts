import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runWeeklyUpdateService,
  type WeekWriteResult,
} from "../../src/server/services/menu.service.js";
import { processAllCanteenAIImages } from "../../src/server/services/image.service.js";
import { sendCronAlert } from "../../src/server/notify.js";

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
    // The write loop commits one week at a time, so "nothing was touched" is
    // only true when it failed before the first upsert landed.
    const committed: WeekWriteResult[] = error?.weeksWritten ?? [];
    await sendCronAlert("error", "Weekly menu update failed", [
      error.message,
      committed.length
        ? `Already committed before the failure: ${committed.map((w) => w.weekId).join(", ")}.`
        : "The stored menu was left untouched.",
    ]);
    return res.status(500).json({
      error: "Menu update failed",
      details: error.message,
      weeksWritten: committed,
    });
  }

  // A partial scrape still persists — one canteen being down should not cost
  // us the other two — but it is worth hearing about.
  if (record.stats.failedCanteens.length > 0) {
    await sendCronAlert("warning", "Some canteens could not be scraped", [
      `Failed: ${record.stats.failedCanteens.join(", ")}`,
      `Stored ${record.stats.dishCount} dishes for ${record.weekId} from the rest.`,
    ]);
  }

  // A week left untouched because its row could not be read. Not data loss —
  // that is the point of skipping — but it is stale until the next run.
  if (record.weeksSkipped.length > 0) {
    await sendCronAlert("warning", "Some weeks were skipped to avoid overwriting them", [
      ...record.weeksSkipped.map((w) => `${w.weekId}: ${w.reason}`),
      "Their stored rows were left as they were; the next run will retry.",
    ]);
  }

  // Dishes the model has now been asked about MAX_ENRICH_ATTEMPTS times without
  // ever answering. They render canned copy from here on and cost nothing more,
  // which is the point — but nobody would ever find out otherwise, and the
  // usual cause is a dish name the scraper mangled rather than a model problem.
  // Only the ones that crossed the line on this run: an exhausted dish stays
  // exhausted for the rest of its week on the menu, and alerting on the whole
  // set would repeat the same message ten times.
  if (record.stats.newlyExhausted.length > 0) {
    await sendCronAlert("warning", "Some dishes have been given up on", [
      `${record.stats.newlyExhausted.length} dish(es) the model never answered for: ` +
        record.stats.newlyExhausted.slice(0, 10).join("; ") +
        (record.stats.newlyExhausted.length > 10 ? " …" : ""),
      "They now render the pattern fallback and are no longer sent. Nothing is cached for them, " +
        "so fixing the cause and clearing dish_cache.enrich_attempts brings them back.",
    ]);
  }

  // Normal late in the week, but worth seeing: it means the canteens disagree
  // about which week it is, and the app is rendering only one of them.
  if (record.weeksWritten.length > 1) {
    await sendCronAlert("warning", "Canteens are mid-rollover across two weeks", [
      ...record.weeksWritten.map((w) => `${w.weekId}: ${w.canteens.join(", ")}`),
      `Showing ${record.weekId}.`,
    ]);
  }

  // Images are best-effort: the menu itself is already safely stored, and a
  // missing plate photo is far less bad than a missing menu.
  //
  // The displayed week goes first and is the only one that fills the per-day
  // slots — those carry no week, so a second week written there would overwrite
  // it. Every other week this run wrote gets its plates into the dish-addressed
  // archive instead, which is what the read path resolves through and what
  // gives a week-ahead view pictures at all. Ordering matters for the same
  // reason: if the budget runs out, it must run out on the week nobody is
  // looking at yet.
  let images = null;
  let imageError: string | null = null;
  try {
    const remainingBudget = () =>
      Math.max(0, MAX_DURATION_MS - (Date.now() - startedAt) - SAFETY_MARGIN_MS);

    images = await processAllCanteenAIImages(record.menuData, {
      budgetMs: remainingBudget(),
      force,
    });

    for (const week of record.weeksWritten) {
      if (week.weekId === record.weekId) continue;
      const ahead = await processAllCanteenAIImages(week.menuData, {
        budgetMs: remainingBudget(),
        force,
        writeSlots: false,
      });
      console.log(
        `📸 [cron] ${week.weekId} (archive only): ${ahead.reused} reused, ` +
          `${ahead.generated} generated, ${ahead.deferred} deferred.`
      );
    }
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
    displayedWeekUnchanged: record.stats.displayedWeekUnchanged,
    canteens: Object.keys(record.menuData.canteens || {}).length,
    dishes: record.stats.dishCount,
    dishesFromCache: record.stats.fromCache,
    // Deliberately not "generated": this counts dishes put in front of the
    // model, and the two numbers differ exactly when something is wrong.
    dishesSentToModel: record.stats.sentToModel,
    dishesDurablyCached: record.stats.durablyCached,
    // Dishes rendering canned copy because the model never answered. Worth
    // watching: a run that asks and durably caches nothing is a broken model
    // key or a rate limit, and looks identical to a quiet day without this.
    dishesUnresolved: record.stats.unresolved.length,
    dishesGivenUpOn: record.stats.exhausted.length,
    failedCanteens: record.stats.failedCanteens,
    // Which canteens landed in which week's row. More than one entry means the
    // kitchens are rolling over and `weekId` above is only the displayed one.
    // menuData is stripped: it is a whole week of menus per entry, and this
    // response is meant to be readable in Vercel's cron run history.
    weeksWritten: record.weeksWritten.map(({ menuData: _menuData, ...week }) => week),
    weeksSkipped: record.weeksSkipped,
    images,
    imageError,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
}
