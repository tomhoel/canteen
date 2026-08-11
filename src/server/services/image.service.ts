import sharp from "sharp";
import ws from "ws";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import type { MenuData } from "@/lib/types";
import { scoreMainDish } from "./scraper.service";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sloutnqpqfesyoycklgd.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsb3V0bnFwcWZlc3lveWNrbGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NzQ2NzYsImV4cCI6MjA5MzU1MDY3Nn0.8QQbCvzFkZzQjJUEYBhBxAHJ-wgf-tfFyj5i-3sUfdo";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws as any },
});

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const IMAGE_SIZE_PX = 1024;
const PLATE_RESIZE_PX = 880;

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

export function normalizeDishName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
    if (y < height - 1) enqueue(idx + height);
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
  if (!supabase) return false;
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
  if (!supabase || srcPath === destPath) return false;
  try {
    const { error } = await supabase.storage.from(bucket).copy(srcPath, destPath);
    if (!error) return true;
  } catch (e) {}

  try {
    const { data, error } = await supabase.storage.from(bucket).download(srcPath);
    if (error || !data) return false;
    const buf = Buffer.from(await data.arrayBuffer());
    return await uploadToSupabase(bucket, destPath, buf);
  } catch (err) {
    return false;
  }
}

export async function generateSingleAIImage(
  dishName: string,
  canteenName: string,
  day: string
): Promise<Buffer | null> {
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
      model: "gemini-2.5-flash",
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

export async function processAllCanteenAIImages(menuData: MenuData) {
  console.log("📸 Auditing and processing AI dish images for main dishes...");

  for (const [canteenName, canteen] of Object.entries(menuData.canteens)) {
    const slug = canteenName.toLowerCase().replace(/\s+/g, "_");

    for (const dayItem of canteen.menu || []) {
      const dayKey = dayItem.day.toLowerCase();
      if (!DAY_ORDER.includes(dayKey)) continue;

      const noItems = dayItem.no?.items || [];
      const enItems = dayItem.en?.items || [];
      const rawItems = noItems.length > 0 ? noItems : enItems;

      if (rawItems.length === 0) continue;

      // Rank items to pick out the true Main Dish (e.g. Buffalo Wings, Slakterbiff, Coq au vin)
      const copy = [...rawItems].sort((a, b) => {
        return scoreMainDish(b.dish, canteenName) - scoreMainDish(a.dish, canteenName);
      });

      const mainDish = copy[0];
      if (!mainDish || !mainDish.dish) continue;

      const cacheKey = normalizeDishName(mainDish.dish);
      const slotPath = `${dayKey}/${slug}.png`;
      const archivePath = `archive/${cacheKey}.png`;

      console.log(`🍽️ Main Dish for ${canteenName} (${dayKey}): "${mainDish.dish}"`);

      // Smart Cache Check: Check if an archived image exists for this exact dish
      const copiedFromArchive = await copyInSupabaseBucket("images_nobg", archivePath, slotPath);
      if (copiedFromArchive) {
        console.log(`  ♻️ Reused archived AI image from Supabase history for "${mainDish.dish}"`);
        continue;
      }

      // Cache Miss: Generate fresh AI plate image via Gemini API
      const aiBuffer = await generateSingleAIImage(mainDish.dish, canteenName, dayKey);
      if (aiBuffer) {
        const transparentBuffer = await removeBgBuffer(aiBuffer);
        // Upload to daily slot AND archive for future reuse
        await uploadToSupabase("images_nobg", slotPath, transparentBuffer);
        await uploadToSupabase("images_nobg", archivePath, transparentBuffer);
        console.log(`  ✨ Generated & archived transparent AI food image to Supabase: images_nobg/${slotPath}`);
      }
    }
  }
}
