#!/usr/bin/env node
/**
 * Manual weekly update — the same work the Vercel Cron job does, run locally.
 *
 * The scheduled run lives in api/cron/update.ts and is triggered by Vercel
 * Cron (see vercel.json). This script exists for running the pipeline by hand:
 * after a prompt change, to backfill a week, or to debug a scrape without
 * waiting for the schedule.
 *
 *   npm run update              # scrape + enrich + persist, reusing archived images
 *   npm run update -- --force   # also regenerate every dish image
 *   npm run update -- --week 2026-W34
 *
 * Requires GEMINI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY in the environment.
 *
 * The npm script loads .env with node's --env-file-if-exists. tsx does *not*
 * read .env on its own, whatever this comment used to claim: `tsx smart-update.js`
 * started, scraped all three canteens, and only then died with
 * "NEXT_PUBLIC_SUPABASE_URL is not set". The documented way to run the pipeline
 * by hand could not reach the database at all. `-if-exists` rather than
 * `--env-file` so the run still works when the variables come from the shell
 * and no .env is present, which is how CI and any one-off invocation would do it.
 *
 * Run through tsx (`npm run update`) rather than bare node: it imports the
 * TypeScript services directly. The previous version imported
 * "./src/server/services/menu.service.js" — a file that does not exist,
 * because the module is .ts — so `node smart-update.js`, which is exactly what
 * the old CI workflow ran, failed with ERR_MODULE_NOT_FOUND every time.
 */

import { pathToFileURL } from "node:url";
import {
  runWeeklyUpdateService,
  invalidateMenuResponseCache,
} from "./src/server/services/menu.service.js";
import { processAllCanteenAIImages } from "./src/server/services/image.service.js";

/**
 * `--week` is the one argument that can do real damage. It is passed straight
 * through as the primary key of a weekly_menus row and overrides whatever week
 * the canteens themselves advertise, so a typo does not fail — it writes this
 * week's food into a row named after the typo, permanently, with no delete path
 * anywhere in the codebase. `--week 34` and `--week --force` are both easy
 * mistakes; validate rather than discover it in the table.
 */
const WEEK_ID = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

export function parseArgs(argv) {
  const force = argv.includes("--force");
  const weekFlag = argv.indexOf("--week");

  if (weekFlag === -1) return { force, weekId: undefined };

  const weekId = argv[weekFlag + 1];
  if (!weekId || weekId.startsWith("--")) {
    throw new Error(`--week needs a week id, e.g. --week ${new Date().getFullYear()}-W34`);
  }
  if (!WEEK_ID.test(weekId)) {
    throw new Error(
      `--week "${weekId}" is not a week id. Expected YYYY-Www with a zero-padded ` +
        `week 01-53, e.g. 2026-W34 — it becomes the primary key of the stored row.`
    );
  }

  return { force, weekId };
}

async function main() {
  const { force, weekId } = parseArgs(process.argv.slice(2));
  if (weekId) console.log(`📌 Overriding the published week — writing everything to ${weekId}.\n`);

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  WEEKLY MENU UPDATE (manual)                             ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const record = await runWeeklyUpdateService(weekId, { force });
  console.log(`\n🔍 Ensuring dish images for ${record.weekId}...`);

  const images = await processAllCanteenAIImages(record.menuData, { force });

  // Every other week this run wrote gets its plates too, archive-only.
  //
  // This loop existed in api/cron/update.ts and not here, and the two updaters
  // are supposed to do the same job. The consequence was invisible until a
  // kitchen published ahead: a manual run enriched next week's dishes but never
  // drew them, and the weekend preview — which is exactly when next week's menu
  // is on screen — showed cards with no picture.
  //
  // `writeSlots: false` is not optional. A slot path is `<day>/<canteen>.png`
  // and carries no week, so writing next week's plate into one would overwrite
  // the picture this week is still showing. The archive is dish-addressed,
  // which is what the read path resolves through for any week that is not the
  // current one.
  for (const week of record.weeksWritten) {
    if (week.weekId === record.weekId) continue;
    console.log(`
🔍 Ensuring dish images for ${week.weekId} (archive only)...`);
    const ahead = await processAllCanteenAIImages(week.menuData, {
      force,
      writeSlots: false,
    });
    console.log(
      `   ${week.weekId}: ${ahead.reused} reused, ${ahead.generated} generated, ` +
        `${ahead.failed} failed`
    );
  }

  // The plates were drawn after the menu was written, so the response cached in
  // between has the food and none of the pictures. Drop it now that both halves
  // exist, or the week that was just illustrated keeps looking unillustrated.
  await invalidateMenuResponseCache(record.weeksWritten.map((w) => w.weekId));

  console.log("\n🏁 Finished.");
  console.log(
    `   week ${record.weekId} · ${Object.keys(record.menuData.canteens).length} canteens · ` +
      `${record.stats.dishCount} dishes (${record.stats.fromCache} cached, ` +
      `${record.stats.sentToModel} asked, ${record.stats.durablyCached} newly cached)`
  );
  console.log(
    `   images: ${images.reused} reused, ${images.generated} generated, ${images.failed} failed`
  );
  if (record.weeksWritten.length > 1) {
    console.log(
      `   weeks written: ${record.weeksWritten.map((w) => `${w.weekId} (${w.canteens.join(", ")})`).join(" · ")}`
    );
  }
  if (record.stats.unresolved.length > 0) {
    console.warn(
      `   ⚠️  ${record.stats.unresolved.length} dish(es) still on a pattern fallback: ` +
        record.stats.unresolved.slice(0, 5).join("; ") +
        (record.stats.unresolved.length > 5 ? " …" : "")
    );
  }
  if (record.stats.exhausted.length > 0) {
    console.warn(`   ⚠️  ${record.stats.exhausted.length} dish(es) given up on (no longer sent).`);
  }
  if (record.stats.failedCanteens.length > 0) {
    console.warn(`   ⚠️  canteens that failed: ${record.stats.failedCanteens.join(", ")}`);
  }
}

// Only run the pipeline when this file is the process entry point. Without the
// guard, importing parseArgs from a test would scrape all three canteens, call
// the model and write to Supabase as a side effect of the import.
const invokedDirectly =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    console.error("\n❌ Update failed:", err.message);
    process.exit(1);
  });
}
