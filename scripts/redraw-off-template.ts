/**
 * Redraws archived plates that are not on the shared reference plate.
 *
 * The cron's own rim check (image.service.ts) catches this at draw time now,
 * but only for dishes on the week it is drawing. A dish that is off-template
 * and not currently on a menu will never be redrawn by anything: the archive
 * is write-once and `force` only rebuilds the current week. That is what this
 * is for.
 *
 * It writes back to the SAME archive key, so every dish_cache.image_nobg_path
 * row stays valid and no migration is involved.
 *
 *   npx tsx --env-file-if-exists=.env scripts/redraw-off-template.ts --scan
 *   npx tsx --env-file-if-exists=.env scripts/redraw-off-template.ts "archive/a.png" "archive/b.png"
 *
 * --scan measures every object under archive/ and redraws the ones that fail.
 * --dry-run measures and reports without drawing or uploading anything.
 *
 * Needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY. Each redraw is a paid
 * image call and replaces bytes that cannot be recovered — the
 * pre-background-removal sources in the `images` bucket were deleted on
 * 2026-09-14, so there is no non-Gemini route back.
 */
import { createClient } from "@supabase/supabase-js";
import {
  generateSingleAIImage,
  removeBgBuffer,
  plateRimDistance,
  uploadToSupabase,
} from "../src/server/services/image.service.js";
import { generatePlatingBrief } from "../src/server/services/ai.service.js";

const BUCKET = "images_nobg";
const ATTEMPTS = 2;

const args = process.argv.slice(2);
const scan = args.includes("--scan");
const dryRun = args.includes("--dry-run");
const explicitKeys = args.filter((a) => !a.startsWith("--"));

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function download(key: string): Promise<Buffer> {
  const { data, error } = await client().storage.from(BUCKET).download(key);
  if (error || !data) throw error ?? new Error(`could not download ${key}`);
  return Buffer.from(await data.arrayBuffer());
}

/** The dish a plate belongs to. The archive key is a lossy fold of the dish
 *  name, so it cannot be turned back into one — dish_cache is the only link. */
async function dishesFor(keys: string[]): Promise<Map<string, string>> {
  const { data, error } = await client()
    .from("dish_cache")
    .select("original_name, image_nobg_path")
    .in("image_nobg_path", keys);
  if (error) throw error;
  return new Map((data ?? []).map((r: any) => [r.image_nobg_path, r.original_name]));
}

async function listArchive(): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client()
      .storage.from(BUCKET)
      .list("archive", { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data?.length) break;
    out.push(...data.map((o) => `archive/${o.name}`));
    if (data.length < 100) break;
  }
  return out;
}

async function main() {
  let keys = explicitKeys;

  if (scan) {
    const all = await listArchive();
    console.log(`Measuring ${all.length} archived plates…`);
    keys = [];
    for (const key of all) {
      const distance = await plateRimDistance(await download(key));
      if (distance !== null && distance > 1) {
        keys.push(key);
        console.log(`  ✗ ${distance.toFixed(2)}x  ${key}`);
      }
    }
    console.log(`${keys.length} of ${all.length} are off-template.\n`);
  }

  if (keys.length === 0) {
    console.log("Nothing to redraw.");
    return;
  }

  const dishes = await dishesFor(keys);
  let fixed = 0;
  let stillOff = 0;

  for (const key of keys) {
    const dish = dishes.get(key);
    if (!dish) {
      console.warn(`⚠️  ${key}: no dish_cache row points at this object — skipping. ` +
        "Without the dish name there is nothing to draw.");
      continue;
    }

    const before = await plateRimDistance(await download(key));
    console.log(`\n"${dish}"\n  before: ${before === null ? "unmeasurable" : before.toFixed(2) + "x"}`);
    if (dryRun) continue;

    const brief = await generatePlatingBrief(dish);
    let best: { buffer: Buffer; distance: number } | null = null;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const raw = await generateSingleAIImage(dish, brief);
      if (!raw) continue;
      const transparent = await removeBgBuffer(raw);
      const distance = await plateRimDistance(transparent);
      if (distance === null) {
        best = { buffer: transparent, distance: 0 };
        break;
      }
      if (!best || distance < best.distance) best = { buffer: transparent, distance };
      console.log(`  attempt ${attempt}: ${distance.toFixed(2)}x`);
      if (distance <= 1) break;
    }

    if (!best) {
      console.warn("  ✗ the model returned nothing — leaving the existing plate alone.");
      continue;
    }

    // Only overwrite on an improvement. A redraw that came back worse than what
    // is already stored is not worth destroying the stored plate for.
    if (before !== null && best.distance >= before) {
      console.warn(`  ✗ redraw is no better (${best.distance.toFixed(2)}x) — keeping the original.`);
      stillOff++;
      continue;
    }

    const ok = await uploadToSupabase(BUCKET, key, best.buffer, "image/webp");
    if (!ok) {
      console.error("  ✗ upload failed — the original is untouched.");
      continue;
    }
    if (best.distance > 1) {
      stillOff++;
      console.log(`  ⚠️  uploaded, but still ${best.distance.toFixed(2)}x off-template.`);
    } else {
      fixed++;
      console.log(`  ✓ uploaded at ${best.distance.toFixed(2)}x — on template.`);
    }
  }

  console.log(`\n${fixed} fixed, ${stillOff} still off-template.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
