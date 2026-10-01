import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  runWeeklyUpdateService,
  invalidateMenuResponseCache,
  type WeekWriteResult,
} from "../../src/server/services/menu.service.js";
import { processAllCanteenAIImages } from "../../src/server/services/image.service.js";
import { sendCronAlert } from "../../src/server/notify.js";
import { publishStaticMenu } from "../../src/server/services/menu-publish.service.js";

/**
 * The weekly updater. This is the only thing that writes menu data.
 *
 * It used to live in a GitHub Actions workflow, but scheduled workflows are
 * disabled automatically after 60 days without repository activity — and this
 * repo intentionally gets no commits, because the menu lives in Redis
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

  // Images are best-effort: the menu itself is already safely stored, and a
  // missing plate photo is far less bad than a missing menu.
  //
  // The displayed week goes first: if the budget runs out, it must run out on
  // the week nobody is looking at yet.
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
      });
      console.log(
        `📸 [cron] ${week.weekId}: ${ahead.reused} reused, ` +
          `${ahead.generated} generated, ${ahead.deferred} deferred.`
      );
    }
    // Dishes whose plate came back on a plate that is not the shared reference
    // one, twice running. The closest draw was archived — a slightly wrong
    // plate beats a foodless card — but the archive is write-once, so it will
    // be reused for that dish forever unless someone clears it. Nothing else
    // surfaces this: it looks exactly like a successful generation.
    if (images.offTemplate.length > 0) {
      await sendCronAlert("warning", "Some plates did not match the reference plate", [
        `${images.offTemplate.length} dish(es) drawn on the wrong plate: ` +
          images.offTemplate.slice(0, 10).join("; ") +
          (images.offTemplate.length > 10 ? " …" : ""),
        "The closest attempt was kept. Clearing the dish's archive object and its " +
          "dish_cache.image_nobg_path makes the next run redraw it.",
      ]);
    }

    // Both halves exist now. The response cached between the write and the
    // drawing has the menu and no pictures; drop it rather than serve it.
    await invalidateMenuResponseCache(record.weeksWritten.map((w) => w.weekId));
  } catch (err: any) {
    imageError = err.message;
    console.warn("⚠️ [cron] Image processing failed:", err.message);
    await sendCronAlert("warning", "Dish images could not be processed", [
      err.message,
      `The menu for ${record.weekId} was stored successfully.`,
    ]);
  }

  // The static copy index.html reads on weekdays. Published after the cache
  // drop above so it is built from the finished record, and before the warm
  // below, which only helps /api/menu. Failure is not fatal: the head script
  // falls back to /api/menu when the file is missing.
  await publishStaticMenu()
    .then((url) => console.log(`📄 [cron] published static menu → ${url}`))
    .catch((err) => console.warn("⚠️ [cron] static menu publish failed:", err.message));

  // The cron is the only writer, and it has just dropped the response cache.
  // Whoever arrives next would otherwise pay the cold origin — measured at
  // 4.5s TTFB against 0.06-0.19s warm. Paying it here instead costs the cron
  // nothing it is not already spending.
  //
  // The URL must be exactly `/api/menu` with no query string: that is
  // byte-for-byte what index.html's head script requests, and it is the cache
  // key for all three layers. A `?week=` variant would warm a Redis key and a
  // CDN entry nobody asks for on load. Going out through the public edge (not
  // an in-process call) is what repopulates the CDN entry as well as Redis.
  // The host is hardcoded rather than read from VERCEL_PROJECT_PRODUCTION_URL,
  // and that is not laziness. Of this project's three production aliases only
  // fbueat.vercel.app answers 200; canteen-tom-hoels-projects.vercel.app and
  // canteen-git-main-... both 302 into Vercel's SSO, which is an edge redirect
  // the function never sees. Warming one of those would warm nothing at all,
  // and would look like it had worked. WARM_HOST overrides it if the public
  // domain ever changes.
  const warmHost = process.env.WARM_HOST || "fbueat.vercel.app";
  await fetch(`https://${warmHost}/api/menu`, { redirect: "manual" })
    .then((r) => {
      // A redirect means we hit an SSO-protected alias and warmed nothing.
      // Say so loudly — the failure mode this replaces was a silent success.
      if (r.status >= 300 && r.status < 400) {
        console.warn(
          `⚠️ [cron] warm hit a redirect (${r.status}) on ${warmHost} — the origin was NOT warmed. ` +
            `Set WARM_HOST to a publicly reachable domain.`
        );
      } else {
        console.log(`🔥 [cron] warmed /api/menu on ${warmHost} → ${r.status}`);
      }
    })
    .catch((err) => console.warn("⚠️ [cron] warm failed:", err.message));

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
