import { getRedis } from "./redis.service.js";
import type { DishOrigin, DishDescription } from "../../lib/types.js";

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
  imagePath: string | null;
  imageNoBgPath: string | null;
  /** How many consecutive runs have asked the model about this dish and got nothing. */
  enrichAttempts: number;
  lastEnrichAttempt: string | null;
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
  imagePath?: string | null;
  imageNoBgPath?: string | null;
  enrichAttempts?: number | null;
  lastEnrichAttempt?: string | null;
}

/**
 * How many times a dish may be sent to the model before the updater gives up
 * on it and renders the pattern fallback instead.
 */
export const MAX_ENRICH_ATTEMPTS = 5;

/**
 * After this long, a given-up dish is worth one more try: the model has moved
 * on, the outage is over, and a dish that reappears months later is cheap to
 * re-ask about exactly once.
 */
export const ENRICH_RETRY_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

/** Attempts that still count against the cap, ignoring ones the cooldown retired. */
export function activeEnrichAttempts(row: DishCacheRow | undefined, now: number): number {
  if (!row || !row.enrichAttempts) return 0;
  if (!row.lastEnrichAttempt) return row.enrichAttempts;
  const last = Date.parse(row.lastEnrichAttempt);
  if (Number.isNaN(last)) return row.enrichAttempts;
  return now - last >= ENRICH_RETRY_COOLDOWN_MS ? 0 : row.enrichAttempts;
}

/** True when this dish has used up its retries and must not be sent again. */
export function isEnrichmentExhausted(row: DishCacheRow | undefined, now: number): boolean {
  return activeEnrichAttempts(row, now) >= MAX_ENRICH_ATTEMPTS;
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
            imagePath: row.imagePath ?? row.image_path ?? null,
            imageNoBgPath: row.imageNoBgPath ?? row.image_no_bg_path ?? null,
            enrichAttempts: row.enrichAttempts ?? row.enrich_attempts ?? 0,
            lastEnrichAttempt: row.lastEnrichAttempt ?? row.last_enrich_attempt ?? null,
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
        imagePath: entry.imagePath !== undefined ? entry.imagePath : (prev.imagePath ?? null),
        imageNoBgPath: entry.imageNoBgPath !== undefined ? entry.imageNoBgPath : (prev.imageNoBgPath ?? null),
        enrichAttempts:
          entry.enrichAttempts !== undefined && entry.enrichAttempts !== null
            ? entry.enrichAttempts
            : (prev.enrichAttempts ?? 0),
        lastEnrichAttempt:
          entry.lastEnrichAttempt !== undefined
            ? entry.lastEnrichAttempt
            : (prev.lastEnrichAttempt ?? null),
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
