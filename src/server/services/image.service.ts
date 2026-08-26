import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuData } from "../../lib/types.js";
import { pickMainDish } from "../../lib/dish-ranking.js";
import { generatePlatingBrief } from "./ai.service.js";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
  archiveObjectKey,
} from "./dish-cache.service.js";

// The cache key function lives with the cache now; re-exported because other
// modules already import it from here.
export { normalizeDishName };

/**
 * Storage writes need the service role key. This used to fall back to a
 * hardcoded anon key, under which every upload was rejected by RLS while the
 * run still reported success — which is why stale plate images kept being
 * served against new dishes.
 */
let cachedClient: SupabaseClient | null = null;
function getStorageClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — cannot upload dish images.");
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — refusing to upload with the anon key, " +
        "which RLS would reject while still reporting success."
    );
  }

  cachedClient = createClient(url, key, { auth: { persistSession: false } });
  return cachedClient;
}

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const IMAGE_SIZE_PX = 1024;
const PLATE_RESIZE_PX = 880;

/**
 * The shared plate reference, in the `images` bucket. Kept under `reference/`
 * so it can never be mistaken for a dish: everything else in these buckets is
 * either `<day>/<canteen>.png` or `archive/<dish>.png`.
 */
const MASTER_PLATE_REF_PATH = "reference/master-plate-ref.png";

/**
 * Image-capable Gemini model. A plain text model (e.g. gemini-2.5-flash) will
 * happily accept responseModalities: ["Text","Image"] and then return no
 * inlineData at all, so every generation silently yields null.
 */
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export async function removeBgBuffer(inputBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(inputBuffer)
    .raw()
    .ensureAlpha()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const isBg = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);
  let qHead = 0;
  let qTail = 0;

  const enqueue = (idx: number) => {
    if (idx >= 0 && idx < totalPixels && !visited[idx]) {
      visited[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (qHead < qTail) {
    const idx = queue[qHead++];
    const pi = idx * channels;
    const r = data[pi];
    const g = data[pi + 1];
    const b = data[pi + 2];
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    const brightness = (r + g + b) / 3;

    if (!(maxDiff < 50 && brightness <= 185)) continue;
    isBg[idx] = 1;

    const x = idx % width;
    const y = Math.floor(idx / width);
    if (x > 0) enqueue(idx - 1);
    if (x < width - 1) enqueue(idx + 1);
    if (y > 0) enqueue(idx - width);
    // Stepping down one row advances by `width`, not `height`. These are equal
    // for the square images Gemini returns, which is why this went unnoticed.
    if (y < height - 1) enqueue(idx + width);
  }

  for (let i = 0; i < totalPixels; i++) {
    if (isBg[i]) data[i * channels + 3] = 0;
  }

  return await sharp(data, { raw: { width, height, channels } })
    .trim()
    .resize(PLATE_RESIZE_PX, PLATE_RESIZE_PX, { fit: "inside" })
    .extend({
      top: Math.floor((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2),
      bottom: Math.ceil((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2),
      left: Math.floor((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2),
      right: Math.ceil((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

export async function uploadToSupabase(
  bucket: string,
  filePath: string,
  buffer: Buffer,
  contentType = "image/png"
): Promise<boolean> {
  const supabase = getStorageClient();
  try {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, buffer, { contentType, upsert: true });
    if (error) throw error;
    return true;
  } catch (err: any) {
    console.error(`❌ Supabase upload failed (${filePath}): ${err.message}`);
    return false;
  }
}

export async function copyInSupabaseBucket(
  bucket: string,
  srcPath: string,
  destPath: string
): Promise<boolean> {
  if (srcPath === destPath) return false;
  const supabase = getStorageClient();
  try {
    const { error } = await supabase.storage.from(bucket).copy(srcPath, destPath);
    if (!error) return true;
  } catch {
    // Server-side copy is an optimisation; fall through to download+upload.
  }

  try {
    const { data, error } = await supabase.storage.from(bucket).download(srcPath);
    if (error || !data) return false;
    const buf = Buffer.from(await data.arrayBuffer());
    return await uploadToSupabase(bucket, destPath, buf);
  } catch (err) {
    return false;
  }
}

/**
 * The one plate every dish is served on, as base64 PNG, or null if it cannot
 * be fetched.
 *
 * Sending the model a picture of the plate is the only thing that actually held
 * the crockery still. Describing it in words does not: a text-only prompt asking
 * for "round warm beige stoneware with a visible raised rim" yields a different
 * piece of stoneware every call — coupes, rimless plates, speckled bowls, a
 * different beige each time. The pre-migration generator passed this reference
 * and the plates matched; the rewrite dropped it and they drifted apart.
 *
 * It lives in Supabase rather than being read off disk because generation now
 * runs inside the Vercel cron function, whose bundle does not include public/.
 * Fetched once per process and cached: the cron draws a whole week per run.
 */
let cachedPlateRef: string | null | undefined;
export async function getMasterPlateRef(): Promise<string | null> {
  if (cachedPlateRef !== undefined) return cachedPlateRef;

  try {
    const { data, error } = await getStorageClient()
      .storage.from("images")
      .download(MASTER_PLATE_REF_PATH);
    if (error || !data) throw error ?? new Error("no data");

    // Downscaled before sending: the stored reference is 1024px / 1.4 MB, and
    // the plate's shape, rim and colour survive 512 intact. This travels on
    // every generation call, so the size is worth paying attention to.
    const resized = await sharp(Buffer.from(await data.arrayBuffer()))
      .resize(512, 512, { fit: "contain" })
      .png()
      .toBuffer();
    cachedPlateRef = resized.toString("base64");
  } catch (err: any) {
    console.warn(
      `⚠️  Master plate reference unavailable (${MASTER_PLATE_REF_PATH}): ${err?.message ?? err}. ` +
        "Plates will be described in words only and will not match each other. " +
        "Run scripts/upload-master-plate.cjs to restore it."
    );
    cachedPlateRef = null;
  }
  return cachedPlateRef;
}

/**
 * Draws one dish.
 *
 * `platingBrief` is the chef's reading of the menu line (see
 * generatePlatingBrief). It is what the model is asked to photograph; the raw
 * dish name is still passed, but as the label of the dish rather than as the
 * description of the picture, because the kitchens' run-on names get rendered
 * word by word when they are the only thing on offer.
 */
export async function generateSingleAIImage(
  dishName: string,
  platingBrief?: string | null
): Promise<Buffer | null> {
  const ai = getAIClient();
  if (!ai) return null;

  const plateRef = await getMasterPlateRef();

  const promptText = `Professional overhead food photography of a single Norwegian canteen lunch dish.

THE DISH: ${platingBrief || dishName}
${platingBrief ? `(The kitchen's menu line for it is "${dishName}".)\n` : ""}
WHAT TO PHOTOGRAPH:
- One finished, plated meal, composed and served the way a chef sends it out.
- A complete, appetizing, cohesive dish where the main components, accompanying sides (e.g. potatoes, rice, vegetables), sauce, and natural garnishes form a balanced, harmonious single meal.
- Cooked food only. Do NOT lay components out separately, do NOT show raw ingredients, and do NOT illustrate the menu line word by word — this is a photograph of a meal, not a diagram of its name.
- Every main component of the dish must be present and recognisable. Do not substitute a different dish.
- Realistic canteen portion covering 60-70% of the plate surface.

THE PLATE:
${plateRef
  ? `- REFERENCE IMAGE PROVIDED: use the EXACT plate in the reference image —
  identical shape, colour, texture, rim profile and proportions. Do not deviate
  in any way. Only the food on it changes.`
  : `- Round warm sandy-beige stoneware dinner plate (#E8D5B7) with a wide, flat,
  clearly raised rim all the way around.`}
- The complete plate with its full rim must be visible, never cropped.

STRICT TECHNICAL SPECIFICATIONS:
- Framing: Overhead 90° view, plate centred in a 1:1 square frame.
- Lighting: Flat even lighting from all directions — ZERO shadows.
- Background: Solid DARK GREY (#707070) seamless studio backdrop.

Strict Exclusions: NO white or grey plates, NO bowls, NO shadows of any kind,
NO utensils, napkins, table surfaces, hands, text or watermarks, NO garnishes
outside the plate, NO angled views.`;

  const requestParts: Array<Record<string, unknown>> = [{ text: promptText }];
  if (plateRef) {
    requestParts.push({ inlineData: { mimeType: "image/png", data: plateRef } });
  }

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: requestParts }],
      config: {
        responseModalities: ["Text", "Image"],
        imageConfig: { aspectRatio: "1:1" },
      },
    });

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          const raw = Buffer.from(part.inlineData.data, "base64");
          return await sharp(raw).png().toBuffer();
        }
      }
    }
  } catch (err: any) {
    console.warn(`⚠️ AI Image generation failed for "${dishName}": ${err.message}`);
  }
  return null;
}

export interface ImageRunOptions {
  /**
   * Stop starting new *generations* once this much wall-clock has elapsed.
   * Archive reuse is cheap and keeps running. Defaults to no limit.
   */
  budgetMs?: number;

  /**
   * Regenerate even when an archived image already exists. Used to rebuild
   * every plate after a prompt change — the job the manual
   * force-regen-images workflow used to do. Expensive: one model call per
   * main dish of the week.
   */
  force?: boolean;

  /**
   * Whether to fill the per-day slots as well as the archive.
   *
   * The slots (`<day>/<canteen>.png`) carry no week, so exactly one week can
   * occupy them — writing a second week's plates there would overwrite the
   * displayed week's. Only the week the app is rendering gets slots; every
   * other week this run wrote gets its plates into the dish-addressed archive,
   * which the read path resolves through `dish_cache.image_nobg_path`. That is
   * what lets a week-ahead view have pictures at all.
   */
  writeSlots?: boolean;
}

export interface ImageRunResult {
  reused: number;
  generated: number;
  failed: number;
  /** Main dishes left without an image because the budget ran out. */
  deferred: number;
  budgetExhausted: boolean;
}

interface ImageJob {
  canteenName: string;
  dayKey: string;
  dish: string;
  slotPath: string;
  archivePath: string;
}

/** Flattens the week into one job per canteen-day main dish. */
function buildImageJobs(menuData: MenuData): ImageJob[] {
  const jobs: ImageJob[] = [];

  for (const [canteenName, canteen] of Object.entries(menuData.canteens || {})) {
    const slug = canteenName.toLowerCase().replace(/\s+/g, "_");

    for (const dayItem of canteen.menu || []) {
      const dayKey = dayItem.day.toLowerCase();
      if (!DAY_ORDER.includes(dayKey)) continue;

      const noItems = dayItem.no?.items || [];
      const enItems = dayItem.en?.items || [];
      const rawItems = noItems.length > 0 ? noItems : enItems;
      if (rawItems.length === 0) continue;

      // Same ranking the client uses, so the generated plate belongs to the
      // dish the card actually shows.
      const mainDish = pickMainDish(rawItems, canteenName);
      if (!mainDish?.dish) continue;

      jobs.push({
        canteenName,
        dayKey,
        dish: mainDish.dish,
        slotPath: `${dayKey}/${slug}.png`,
        archivePath: `archive/${archiveObjectKey(mainDish.dish)}.png`,
      });
    }
  }

  return jobs;
}

/** Concurrency pool helper for parallel network and AI tasks. */
async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx]);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Ensures every main dish of the week has a plate image in its daily slot.
 *
 * Work is ordered cheap-first: dishes already in the archive are copied
 * (fast, free, in parallel), and only genuine cache misses hit the image model
 * in a concurrent worker pool (concurrency 2). With a budget set, unfinished
 * generations are simply deferred — the next run picks them up, because the
 * archive check makes the whole pass idempotent.
 */
export async function processAllCanteenAIImages(
  menuData: MenuData,
  options: ImageRunOptions = {}
): Promise<ImageRunResult> {
  const { budgetMs, force = false, writeSlots = true } = options;
  const startedAt = Date.now();
  const outOfTime = () => budgetMs !== undefined && Date.now() - startedAt >= budgetMs;

  const jobs = buildImageJobs(menuData);
  console.log(
    `📸 ${jobs.length} main dishes to ensure images for` +
      (force ? " (force: ignoring archive)" : "") +
      (writeSlots ? "" : " (archive only — not the displayed week)") +
      "..."
  );

  const result: ImageRunResult = {
    reused: 0,
    generated: 0,
    failed: 0,
    deferred: 0,
    budgetExhausted: false,
  };

  const { rows: cache, failed: cacheUnreadable } = await loadDishCache(jobs.map((j) => j.dish));
  if (cacheUnreadable) {
    console.warn("⚠️  dish_cache unreadable — falling back to archive paths; some plates may be redrawn.");
  }
  const newlyDrawn: Array<{ dish: string; archivePath: string }> = [];
  const needsGeneration: ImageJob[] = [];

  // Phase 1: Parallel slot sync & archive reuse (concurrency 5)
  await asyncPool(5, jobs, async (job) => {
    const knownPath = cache.get(normalizeDishName(job.dish))?.imageNoBgPath ?? null;

    if (!force) {
      if (writeSlots) {
        const source = knownPath ?? job.archivePath;
        const copied = await copyInSupabaseBucket("images_nobg", source, job.slotPath);
        if (copied) {
          result.reused++;
          if (!knownPath) newlyDrawn.push({ dish: job.dish, archivePath: source });
          console.log(`  ♻️ Reused image for "${job.dish}" (${job.canteenName}/${job.dayKey})`);
          return;
        }
      } else if (knownPath) {
        result.reused++;
        return;
      }
    }

    needsGeneration.push(job);
  });

  // Phase 2: Deduplicate and generate missing dish images in parallel (concurrency 2)
  const uniqueGenJobs: ImageJob[] = [];
  const seenDishes = new Set<string>();
  for (const job of needsGeneration) {
    const norm = normalizeDishName(job.dish);
    if (!seenDishes.has(norm)) {
      seenDishes.add(norm);
      uniqueGenJobs.push(job);
    }
  }

  await asyncPool(2, uniqueGenJobs, async (job) => {
    if (outOfTime()) {
      const remainingCount = needsGeneration.filter(
        (j) => normalizeDishName(j.dish) === normalizeDishName(job.dish)
      ).length;
      result.deferred += remainingCount;
      result.budgetExhausted = true;
      return;
    }

    const platingBrief = await generatePlatingBrief(job.dish);
    if (platingBrief) console.log(`  🍽️  "${job.dish}" → ${platingBrief}`);

    const aiBuffer = await generateSingleAIImage(job.dish, platingBrief);
    if (!aiBuffer) {
      const failCount = needsGeneration.filter(
        (j) => normalizeDishName(j.dish) === normalizeDishName(job.dish)
      ).length;
      result.failed += failCount;
      return;
    }

    const transparentBuffer = await removeBgBuffer(aiBuffer);
    const archiveOk = await uploadToSupabase("images_nobg", job.archivePath, transparentBuffer);

    const matchingJobs = needsGeneration.filter(
      (j) => normalizeDishName(j.dish) === normalizeDishName(job.dish)
    );

    if (writeSlots) {
      for (const mJob of matchingJobs) {
        await uploadToSupabase("images_nobg", mJob.slotPath, transparentBuffer);
      }
    }

    if (archiveOk) {
      result.generated += matchingJobs.length;
      newlyDrawn.push({ dish: job.dish, archivePath: job.archivePath });
      console.log(`  ✨ Generated images_nobg/${job.archivePath} for "${job.dish}"`);
    } else {
      result.failed += matchingJobs.length;
    }
  });

  // Record where each new plate landed so future weeks reuse it directly.
  if (newlyDrawn.length > 0) {
    await saveDishCacheEntries(
      newlyDrawn.map(({ dish, archivePath }) => ({
        cacheKey: normalizeDishName(dish),
        originalName: dish,
        origin: null,
        description: null,
        imagePath: null,
        imageNoBgPath: archivePath,
      }))
    );
  }

  if (result.budgetExhausted) {
    console.warn(
      `⏳ Image budget of ${budgetMs}ms exhausted — ${result.deferred} dish(es) deferred to the next run.`
    );
  }
  console.log(
    `📸 Images: ${result.reused} reused, ${result.generated} generated, ${result.failed} failed, ${result.deferred} deferred.`
  );

  return result;
}
