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
 * SUPABASE_SERVICE_ROLE_KEY in the environment (a local .env is picked up by
 * tsx automatically via --env-file, or export them in the shell).
 *
 * Run through tsx (`npm run update`) rather than bare node: it imports the
 * TypeScript services directly. The previous version imported
 * "./src/server/services/menu.service.js" — a file that does not exist,
 * because the module is .ts — so `node smart-update.js`, which is exactly what
 * the old CI workflow ran, failed with ERR_MODULE_NOT_FOUND every time.
 */

import { pathToFileURL } from "node:url";
import { runWeeklyUpdateService } from "./src/server/services/menu.service.js";
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
