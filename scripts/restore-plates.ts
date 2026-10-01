// One-off: put the plates back after the move from Vercel Blob to Supabase Storage.
//
// Source of truth is the local backup of 2026-09-14 (backups/supabase/...), which is
// already WebP, plus the plate reference and closed-day plates tracked in assets/.
// Plates drawn after that date existed only in the suspended Blob store; this clears
// their dish_cache path so the updater redraws them when a dish needs one.
//
// Usage: node --env-file=.env --import tsx scripts/restore-plates.ts [--dry]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { uploadToStorage } from "../src/server/services/image.service.js";
import { putObject, objectExists } from "../src/server/services/storage.service.js";
import { getRedis } from "../src/server/services/redis.service.js";
import { saveDishCacheEntries, type DishCacheRow } from "../src/server/services/dish-cache.service.js";

const dry = process.argv.includes("--dry");
const archiveDir = "backups/supabase/buckets/images_nobg/archive";
const files = fs.readdirSync(archiveDir);
console.log(`${files.length} plates in the backup${dry ? " (dry run)" : ""}`);

// 1. Plates + thumbs (uploadToStorage writes both), a few at a time.
let done = 0;
let skipped = 0;
let failed = 0;
const queue = [...files];
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      if (dry) continue;
      if ((await objectExists("images_nobg", `archive/${name}`)) === true) {
        skipped++;
        continue;
      }
      const ok = await uploadToStorage("images_nobg", `archive/${name}`, fs.readFileSync(path.join(archiveDir, name)), "image/webp");
      if (ok) done++;
      else failed++;
      if ((done + failed) % 50 === 0) console.log(`  ${done + failed} uploaded...`);
    }
  })
);
console.log(`plates: ${done} uploaded, ${skipped} already there, ${failed} failed`);

// 2. Closed-day plates (WebP bytes under .png keys, like the archive) and the reference.
for (const n of [1, 2, 3]) {
  const src = `assets/source-images/closed-plates/closed-plate-${n}.png`;
  const webp = await sharp(src).resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  if (!dry) await uploadToStorage("images_nobg", `closed-plates/closed-plate-${n}.png`, webp, "image/webp");
}
if (!dry) await putObject("images", "reference/master-plate-ref.png", fs.readFileSync("assets/source-images/master-plate-ref.png"), "image/png", 86400);
console.log(dry ? "would upload the closed-day plates and the plate reference" : "closed-day plates and the plate reference uploaded");

// 3. dish_cache rows that point at a plate nobody can supply right now: forget the path.
const have = new Set(files.map((f) => `archive/${f}`));
const redis = getRedis();
if (!redis) throw new Error("Redis is not configured");
const all = (await redis.hgetall<Record<string, unknown>>("dish_cache")) ?? {};
const forget: Array<{ cacheKey: string; originalName: string; imageNoBgPath: null }> = [];
for (const [key, val] of Object.entries(all)) {
  const row = (typeof val === "string" ? JSON.parse(val) : val) as Partial<DishCacheRow>;
  if (row.imageNoBgPath && !have.has(row.imageNoBgPath)) {
    forget.push({ cacheKey: key, originalName: row.originalName ?? key, imageNoBgPath: null });
  }
}
console.log(`${forget.length} dishes point at a plate that is not in the backup; clearing their path so the updater redraws them`);
if (!dry && forget.length) await saveDishCacheEntries(forget);
