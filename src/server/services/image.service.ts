import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { put } from "@vercel/blob";
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
    // WebP, not PNG. Nothing ever fetches this object directly — every display
    // path goes through Supabase's /render/image/ transform, which re-encodes
    // to WebP at 340, 640 or 1080 px. So the stored PNG was a 1.6 MB master
    // whose only job was to be re-encoded down to ~24 KB, 335 times over: 556 MB
    // to serve bytes nobody ever received.
    //
    // Dimensions are deliberately unchanged at 1024². The lightbox asks for
    // 1080, so the master is already the smallest size that serves every
    // variant at native resolution; shrinking it would be the first real
    // quality loss this pipeline has ever taken.
    //
    // q90 with alphaQuality 100 measured at 8.4% of the PNG across a sample of
    // 12 real plates (7.0-9.4%, none grew, none lost alpha). The alpha is not
    // negotiable — these are cut-out plates composited on a warm gradient, and
    // a damaged alpha edge shows as a grey fringe at the plate rim.
    .webp({ quality: 90, alphaQuality: 100, effort: 4 })
    .toBuffer();
}

/**
 * The reference plate's rim, measured by the function below across all 335
 * archived plates on 2026-09-14: hue 33 +/- 3, saturation 0.39 +/- 0.04.
 *
 * The tolerances are set at roughly twice the observed spread of the 324
 * plates that match, which is wide enough that none of them is rejected and
 * still tight enough to catch both ways this has actually failed:
 *
 *   - a terracotta plate drawn 2026-09-09 with the reference attached and
 *     ignored by the model — hue 22, saturation 0.62
 *   - ten pale plates drawn 14-16 Aug 2026 while no reference was being sent
 *     at all — right hue, saturation 0.19-0.28
 */
const PLATE_RIM_HUE = 33;
const PLATE_RIM_HUE_TOLERANCE = 6;
const PLATE_RIM_SATURATION = 0.39;
const PLATE_RIM_SATURATION_TOLERANCE = 0.1;

/**
 * How far this plate's rim is from the reference plate's, as a multiple of the
 * tolerance: <= 1 is on-template, > 1 is not, and a smaller number is closer.
 * One number so the same measurement both rejects a draw and ranks the
 * attempts when every draw is rejected.
 *
 * Returns null when the rim cannot be located — a plate that could not be
 * measured is not the same thing as a plate that is wrong, and redrawing it
 * would not make it measurable.
 *
 * The rim is sampled relative to *this plate's own outer edge*, not the canvas.
 * removeBgBuffer resizes to PLATE_RESIZE_PX and centre-extends to IMAGE_SIZE_PX,
 * so a plate only ever covers ~86% of the frame, and the trim before it varies
 * per image — a fixed annulus lands in the transparent margin and measures
 * nothing.
 */
export async function plateRimDistance(plateBuffer: Buffer): Promise<number | null> {
  const { data, info } = await sharp(plateBuffer)
    .resize(160, 160, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const cx = width / 2;
  const cy = height / 2;
  const opaqueAt = (x: number, y: number) => data[(y * width + x) * 4 + 3] >= 200;

  let outerRadius = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaqueAt(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > outerRadius) outerRadius = d;
    }
  }
  if (outerRadius < 10) return null;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!opaqueAt(x, y)) continue;
      const d = Math.hypot(x - cx, y - cy) / outerRadius;
      if (d < 0.86 || d > 0.96) continue;
      const i = (y * width + x) * 4;
      sumR += data[i];
      sumG += data[i + 1];
      sumB += data[i + 2];
      count++;
    }
  }
  if (count < 40) return null;

  const r = sumR / count;
  const g = sumG / count;
  const b = sumB / count;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;

  let hue = 0;
  if (chroma > 0) {
    hue =
      60 *
      (max === r ? (((g - b) / chroma) % 6) : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4);
    if (hue < 0) hue += 360;
  }
  const saturation = max > 0 ? chroma / max : 0;

  let hueDelta = Math.abs(hue - PLATE_RIM_HUE);
  if (hueDelta > 180) hueDelta = 360 - hueDelta;

  return Math.max(
    hueDelta / PLATE_RIM_HUE_TOLERANCE,
    Math.abs(saturation - PLATE_RIM_SATURATION) / PLATE_RIM_SATURATION_TOLERANCE
  );
}

/**
 * Draws per dish. The model ignores the reference plate about 1 time in 335, so
 * a single redraw clears essentially all of it; a third attempt would triple
 * the worst-case cost of a rejected dish to chase the remaining ~0.001%.
 */
const PLATE_DRAW_ATTEMPTS = 2;

export async function uploadToStorage(
  bucket: string,
  filePath: string,
  buffer: Buffer,
  contentType = "image/webp"
): Promise<boolean> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.warn(`⚠️  BLOB_READ_WRITE_TOKEN is not set — cannot upload ${bucket}/${filePath}`);
    return false;
  }
  const blobPath = `${bucket}/${filePath}`;
  try {
    await put(blobPath, buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType,
      token,
    });
    return true;
  } catch (err: any) {
    console.error(`❌ Blob upload failed (${blobPath}): ${err?.message ?? err}`);
    return false;
  }
}

// Keep alias for backwards compatibility
export const uploadToSupabase = uploadToStorage;

export async function copyInStorageBucket(
  bucket: string,
  srcPath: string,
  destPath: string
): Promise<boolean> {
  if (srcPath === destPath) return false;
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;

  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BLOB_BASE_URL ||
      process.env.BLOB_BASE_URL ||
      "https://public.blob.vercel-storage.com";
    const res = await fetch(`${baseUrl}/${bucket}/${srcPath}`);
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    return await uploadToStorage(bucket, destPath, buf);
  } catch {
    return false;
  }
}

// Keep alias for backwards compatibility
export const copyInSupabaseBucket = copyInStorageBucket;

let cachedPlateRef: string | undefined;
export async function getMasterPlateRef(): Promise<string | null> {
  if (cachedPlateRef !== undefined) return cachedPlateRef;

  // 1. Try local disk first (instant, free, works offline)
  const localCandidates = [
    path.join(process.cwd(), "assets", "source-images", "master-plate-ref.png"),
    path.join(process.cwd(), "backups", "supabase", "buckets", "images", "reference", "master-plate-ref.png"),
  ];

  for (const p of localCandidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p);
        const resized = await sharp(raw)
          .resize(512, 512, { fit: "contain" })
          .png()
          .toBuffer();
        cachedPlateRef = resized.toString("base64");
        return cachedPlateRef;
      } catch {
        // Fall back to next candidate
      }
    }
  }

  // 2. Try fetching from Blob if deployed
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_BLOB_BASE_URL ||
      process.env.BLOB_BASE_URL ||
      "https://public.blob.vercel-storage.com";
    const res = await fetch(`${baseUrl}/images/${MASTER_PLATE_REF_PATH}`);
    if (res.ok) {
      const resized = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(512, 512, { fit: "contain" })
        .png()
        .toBuffer();
      cachedPlateRef = resized.toString("base64");
      return cachedPlateRef;
    }
  } catch {
    // Blob fetch failed, proceed to warning
  }

  console.warn(
    `⚠️  Master plate reference unavailable (${MASTER_PLATE_REF_PATH}). ` +
      "This plate will be described in words only and may not match the others."
  );
  return null;
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
  /**
   * Dishes whose plate was still off-template after every attempt. The closest
   * draw was archived anyway — a slightly wrong plate beats a foodless card,
   * and it stays fixable by hand — but nothing else would ever surface it.
   */
  offTemplate: string[];
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

      // The `.png` suffix is a historical key, not a format claim. These
      // objects hold WebP bytes as of 2026-09-14; the extension stays because
      // 319 dish_cache.image_nobg_path rows end in `.png` and
      // src/server/menu.ts resolves them verbatim. Renaming would mean a
      // 319-row migration with a window — Redis 10 min, CDN swr up to 24 h —
      // where cached responses point at objects that no longer exist, i.e. a
      // blank card for every dish, for hours, to buy a tidier filename.
      // Nothing reads the extension: imgproxy sniffs the body and Supabase
      // serves the stored contentType.
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
    offTemplate: [],
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

    // Draw, then check the plate the model actually returned and redraw once if
    // it ignored the reference. Nothing downstream reads the plate, so without
    // this an off-template draw is archived permanently and reused for that
    // dish forever — the archive is write-once and only `force` redraws it.
    let best: { buffer: Buffer; distance: number } | null = null;
    for (let attempt = 1; attempt <= PLATE_DRAW_ATTEMPTS; attempt++) {
      const aiBuffer = await generateSingleAIImage(job.dish, platingBrief);
      if (!aiBuffer) continue;

      const transparent = await removeBgBuffer(aiBuffer);
      const distance = await plateRimDistance(transparent);

      // Unmeasurable is not the same as wrong, and a redraw will not make it
      // measurable. Take it and stop.
      if (distance === null) {
        best = { buffer: transparent, distance: 0 };
        break;
      }

      if (!best || distance < best.distance) best = { buffer: transparent, distance };
      if (distance <= 1) break;

      console.warn(
        `  🎨 "${job.dish}": plate is ${distance.toFixed(2)}x off-template on attempt ${attempt}` +
          (attempt < PLATE_DRAW_ATTEMPTS ? " — redrawing." : " — keeping the closest draw.")
      );
    }

    if (!best) {
      const failCount = needsGeneration.filter(
        (j) => normalizeDishName(j.dish) === normalizeDishName(job.dish)
      ).length;
      result.failed += failCount;
      return;
    }

    if (best.distance > 1) result.offTemplate.push(job.dish);
    const transparentBuffer = best.buffer;
    // Explicit contentType at the call site rather than flipping the default in
    // uploadToSupabase: copyInSupabaseBucket falls through to that default when
    // a server-side copy fails, and it would then relabel a legacy PNG body as
    // WebP. The bytes are what matter — Supabase serves the stored contentType
    // and imgproxy sniffs the body — but a wrong label is a lie that outlives us.
    const archiveOk = await uploadToSupabase(
      "images_nobg",
      job.archivePath,
      transparentBuffer,
      "image/webp"
    );

    const matchingJobs = needsGeneration.filter(
      (j) => normalizeDishName(j.dish) === normalizeDishName(job.dish)
    );

    if (writeSlots) {
      for (const mJob of matchingJobs) {
        await uploadToSupabase("images_nobg", mJob.slotPath, transparentBuffer, "image/webp");
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
    `📸 Images: ${result.reused} reused, ${result.generated} generated, ${result.failed} failed, ` +
      `${result.deferred} deferred, ${result.offTemplate.length} off-template.`
  );

  return result;
}
