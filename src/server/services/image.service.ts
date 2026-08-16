import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { MenuData } from "../../lib/types.js";
import { pickMainDish } from "../../lib/dish-ranking.js";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
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

export async function generateSingleAIImage(dishName: string): Promise<Buffer | null> {
  const ai = getAIClient();
  if (!ai) return null;

  const promptText = `Professional overhead food photography of "${dishName}".

STRICT TECHNICAL SPECIFICATIONS:
- Framing: Overhead 90° view, plate centered in 1:1 square frame.
- Plate: Round warm beige/cream stoneware dinner plate (#E8D5B7) with visible raised rim.
- Food: Professional restaurant plating, appetizing portion of "${dishName}".
- Lighting: Flat even lighting from all directions — ZERO shadows.
- Background: Solid DARK GREY (#707070) seamless studio backdrop.

Strict Exclusions: NO white plates, NO shadows, NO utensils, NO table text or garnishes outside plate.`;

  try {
    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: promptText }] }],
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
        archivePath: `archive/${normalizeDishName(mainDish.dish)}.png`,
      });
    }
  }

  return jobs;
}

/**
 * Ensures every main dish of the week has a plate image in its daily slot.
 *
 * Work is ordered cheap-first: dishes already in the archive are copied
 * (fast, free), and only genuine cache misses hit the image model. With a
 * budget set, unfinished generations are simply deferred — the next run picks
 * them up, because the archive check makes the whole pass idempotent.
 */
export async function processAllCanteenAIImages(
  menuData: MenuData,
  options: ImageRunOptions = {}
): Promise<ImageRunResult> {
  const { budgetMs, force = false } = options;
  const startedAt = Date.now();
  const outOfTime = () => budgetMs !== undefined && Date.now() - startedAt >= budgetMs;

  const jobs = buildImageJobs(menuData);
  console.log(
    `📸 ${jobs.length} main dishes to ensure images for${force ? " (force: ignoring archive)" : ""}...`
  );

  const result: ImageRunResult = {
    reused: 0,
    generated: 0,
    failed: 0,
    deferred: 0,
    budgetExhausted: false,
  };

  // One read tells us which of this week's dishes have been drawn before,
  // instead of attempting a storage copy per dish and learning from the miss.
  //
  // A failed read is survivable here in a way it is not for enrichment: the
  // archive path is a deterministic function of the dish name, so the copy
  // still finds most plates without the cache. It does miss the ones stored
  // under the older slug convention, which then get redrawn — worth a line in
  // the log so an expensive run is explainable after the fact.
  const { rows: cache, failed: cacheUnreadable } = await loadDishCache(jobs.map((j) => j.dish));
  if (cacheUnreadable) {
    console.warn("⚠️  dish_cache unreadable — falling back to archive paths; some plates may be redrawn.");
  }
  const newlyDrawn: Array<{ dish: string; archivePath: string }> = [];

  for (const job of jobs) {
    // Cheap path: this exact dish has been drawn before, in any past week.
    if (!force) {
      const known = cache.get(normalizeDishName(job.dish))?.imageNoBgPath ?? job.archivePath;
      const copied = await copyInSupabaseBucket("images_nobg", known, job.slotPath);
      if (copied) {
        result.reused++;
        console.log(`  ♻️ Reused image for "${job.dish}" (${job.canteenName}/${job.dayKey})`);
        continue;
      }
    }

    if (outOfTime()) {
      result.deferred++;
      result.budgetExhausted = true;
      continue;
    }

    const aiBuffer = await generateSingleAIImage(job.dish);
    if (!aiBuffer) {
      result.failed++;
      continue;
    }

    const transparentBuffer = await removeBgBuffer(aiBuffer);
    const slotOk = await uploadToSupabase("images_nobg", job.slotPath, transparentBuffer);
    // Archive under the dish name so the same dish is free for every future week.
    const archiveOk = await uploadToSupabase("images_nobg", job.archivePath, transparentBuffer);

    if (slotOk) {
      result.generated++;
      if (archiveOk) newlyDrawn.push({ dish: job.dish, archivePath: job.archivePath });
      console.log(`  ✨ Generated images_nobg/${job.slotPath} for "${job.dish}"`);
    } else {
      result.failed++;
    }
  }

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
