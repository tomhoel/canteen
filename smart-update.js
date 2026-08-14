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

import { runWeeklyUpdateService } from "./src/server/services/menu.service.ts";
import { processAllCanteenAIImages } from "./src/server/services/image.service.ts";

function parseArgs(argv) {
  const force = argv.includes("--force");
  const weekFlag = argv.indexOf("--week");
  const weekId = weekFlag !== -1 ? argv[weekFlag + 1] : undefined;
  return { force, weekId };
}

async function main() {
  const { force, weekId } = parseArgs(process.argv.slice(2));

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  WEEKLY MENU UPDATE (manual)                             ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  const record = await runWeeklyUpdateService(weekId);
  console.log(`\n🔍 Generating dish images for ${record.weekId}...`);

  const images = await processAllCanteenAIImages(record.menuData, { force });

  console.log("\n🏁 Finished.");
  console.log(
    `   week ${record.weekId} · ${Object.keys(record.menuData.canteens).length} canteens · ` +
      `${images.reused} images reused, ${images.generated} generated, ${images.failed} failed`
  );
}

main().catch((err) => {
  console.error("\n❌ Update failed:", err.message);
  process.exit(1);
});
