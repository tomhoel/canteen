import { getRedis } from "./redis.service.js";
import type { DishOrigin, DishDescription, DishCourse } from "../../lib/types.js";

/**
 * Per-dish cache backed by Upstash Redis `dish_cache` hash.
 *
 * A dish name is stable across weeks — "Slakterbiff med bearnaise" means the
 * same thing in week 33 and week 41 — so its origin, description and plate
 * image only ever need producing once.
 *
 * Stored as fields in the `dish_cache` hash in Upstash Redis, keyed by `cacheKey`.
 */

/** A cache row as stored. Every field is present, null where unfilled. */
export interface DishCacheRow {
  cacheKey: string;
  originalName: string;
  origin: DishOrigin | null;
  description: DishDescription | null;
  /**
   * A shortened form of the dish name, for the card's headline only.
   *
   * Null for a dish whose name already fits, which is most of them — the
   * updater only asks about titles past SHORT_TITLE_TARGET_CHARS. Deliberately
   * not the same thing as `originalName`: that is the cache key, the name a
   * plate is archived under and what the recipe generator is asked about, and
   * it must not move.
   */
  shortName: string | null;
  /**
   * What kind of dish this is (meat plate, soup, ...), labelled once by the
   * model and used to pick the day's headline. Null until labelled; the name
   * rules in dish-ranking stand in for it.
   */
  course: DishCourse | null;
  imagePath: string | null;
  imageNoBgPath: string | null;
}

/**
 * A partial write: only the fields actually present are touched, so a run that
 * produced an image cannot blank a description another run filled in.
 */
export interface DishCacheEntry {
  cacheKey: string;
  originalName: string;
  origin?: DishOrigin | null;
  description?: DishDescription | null;
  shortName?: string | null;
  course?: DishCourse | null;
  imagePath?: string | null;
  imageNoBgPath?: string | null;
}

/**
 * Canonical cache key for a dish name: lowercased, punctuation stripped,
 * whitespace collapsed. Small spelling/punctuation drift from the kitchen
 * therefore still resolves to the same cached dish.
 */
export function normalizeDishName(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The archive object key for a dish — the cache key, folded to ASCII.
 */
export function archiveObjectKey(dishName: string): string {
  return normalizeDishName(dishName)
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cache rows keyed by normalised name, plus whether the read was trustworthy. */
export interface DishCacheLoad {
  rows: Map<string, DishCacheRow>;
  failed: boolean;
}

const HASH_KEY = "dish_cache";

/**
 * Loads cache rows for the given dish names from Upstash Redis, keyed by normalised name.
 */
export async function loadDishCache(dishNames: string[]): Promise<DishCacheLoad> {
  const cache = new Map<string, DishCacheRow>();
  const redis = getRedis();
  if (!redis) return { rows: cache, failed: true };
  if (dishNames.length === 0) return { rows: cache, failed: false };

  const keys = Array.from(new Set(dishNames.map(normalizeDishName).filter(Boolean)));
  if (keys.length === 0) return { rows: cache, failed: false };

  try {
    const rawData = await redis.hmget<Record<string, unknown>>(HASH_KEY, ...keys);
    if (rawData) {
      for (const [key, val] of Object.entries(rawData)) {
        if (!val) continue;
        let row: any = val;
        if (typeof val === "string") {
          try {
            row = JSON.parse(val);
          } catch {
            continue;
          }
        }
        if (row && typeof row === "object") {
          cache.set(key, {
            cacheKey: row.cacheKey ?? row.cache_key ?? key,
            originalName: row.originalName ?? row.original_name ?? "",
            origin: row.origin ?? null,
            description: row.description ?? null,
            shortName: row.shortName ?? row.short_name ?? null,
            course: row.course ?? null,
            imagePath: row.imagePath ?? row.image_path ?? null,
            imageNoBgPath: row.imageNoBgPath ?? row.image_no_bg_path ?? null,
          });
        }
      }
    }
    return { rows: cache, failed: false };
  } catch (err: any) {
    console.warn(`⚠️  dish_cache read failed: ${err?.message ?? err}`);
    return { rows: cache, failed: true };
  }
}

/**
 * Writes entries back to Upstash Redis, merging rather than overwriting.
 */
export async function saveDishCacheEntries(entries: DishCacheEntry[]): Promise<number> {
  const redis = getRedis();
  if (!redis || entries.length === 0) return 0;

  const validEntries = entries.filter((e) => e.cacheKey);
  if (validEntries.length === 0) return 0;

  const keys = Array.from(new Set(validEntries.map((e) => e.cacheKey)));

  try {
    // Read existing entries so we can merge partial updates
    const existingRaw = (await redis.hmget<Record<string, unknown>>(HASH_KEY, ...keys)) ?? {};
    const existing: Record<string, Partial<DishCacheRow>> = {};
    for (const [k, v] of Object.entries(existingRaw)) {
      if (!v) continue;
      if (typeof v === "string") {
        try {
          existing[k] = JSON.parse(v);
        } catch {
          // Ignore invalid JSON in corrupted field
        }
      } else if (typeof v === "object") {
        existing[k] = v as Partial<DishCacheRow>;
      }
    }

    const updates: Record<string, string> = {};
    for (const entry of validEntries) {
      const prev = existing[entry.cacheKey] || {};
      const merged: DishCacheRow = {
        cacheKey: entry.cacheKey,
        originalName: entry.originalName ?? prev.originalName ?? "",
        origin: entry.origin !== undefined ? entry.origin : (prev.origin ?? null),
        description: entry.description !== undefined ? entry.description : (prev.description ?? null),
        shortName: entry.shortName !== undefined ? entry.shortName : (prev.shortName ?? null),
        course: entry.course !== undefined ? entry.course : (prev.course ?? null),
        imagePath: entry.imagePath !== undefined ? entry.imagePath : (prev.imagePath ?? null),
        imageNoBgPath: entry.imageNoBgPath !== undefined ? entry.imageNoBgPath : (prev.imageNoBgPath ?? null),
      };

      existing[entry.cacheKey] = merged;
      updates[entry.cacheKey] = JSON.stringify(merged);
    }

    await redis.hset(HASH_KEY, updates);
    return Object.keys(updates).length;
  } catch (err: any) {
    console.warn(`⚠️  dish_cache write failed: ${err?.message ?? err}`);
    return 0;
  }
}

const TITLE_FIXES_KEY = "title_fixes";

/**
 * Remembered proofreading answers: the title as scraped -> the title to use
 * (the same text when the model found nothing to fix).
 *
 * The updater used to proofread every title on every run, 3 model calls
 * that mostly changed nothing, and the model is not deterministic: a title it
 * fixed on one run and left alone on the next got a different dish_cache key, so
 * the dish was enriched, and sometimes drawn, twice. Asking once and keeping the
 * answer makes the key stable.
 *
 * Fails soft in both directions: an unreadable hash just means those titles are
 * asked about again.
 */
export async function loadTitleFixes(titles: string[]): Promise<Map<string, string>> {
  const known = new Map<string, string>();
  const redis = getRedis();
  if (!redis || titles.length === 0) return known;
  try {
    const raw = (await redis.hmget<Record<string, unknown>>(TITLE_FIXES_KEY, ...titles)) ?? {};
    for (const [title, fixed] of Object.entries(raw)) {
      if (typeof fixed === "string" && fixed.trim()) known.set(title, fixed);
    }
  } catch (err: any) {
    console.warn(`⚠️  title_fixes read failed: ${err?.message ?? err}`);
  }
  return known;
}

export async function saveTitleFixes(fixes: Record<string, string>): Promise<void> {
  const redis = getRedis();
  if (!redis || Object.keys(fixes).length === 0) return;
  try {
    await redis.hset(TITLE_FIXES_KEY, fixes);
  } catch (err: any) {
    console.warn(`⚠️  title_fixes write failed: ${err?.message ?? err}`);
  }
}
