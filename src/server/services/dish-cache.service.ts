import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DishOrigin, DishDescription } from "../../lib/types";

/**
 * Per-dish cache backed by the Supabase `dish_cache` table.
 *
 * A dish name is stable across weeks — "Slakterbiff med bearnaise" means the
 * same thing in week 33 and week 41 — so its origin, description and plate
 * image only ever need producing once. This table already held 205 fully
 * enriched dishes going back to May; the v2 pipeline ignored it and re-asked
 * the model for every dish on every run (twice daily), which was both
 * expensive and why descriptions changed wording between runs.
 *
 * Table shape (pre-existing, not created here):
 *   cache_key TEXT PRIMARY KEY, original_name, clean_name,
 *   origin JSONB, description JSONB, image_path, image_nobg_path, first_seen
 */

export interface DishCacheEntry {
  cacheKey: string;
  originalName: string;
  origin: DishOrigin | null;
  description: DishDescription | null;
  imagePath: string | null;
  imageNoBgPath: string | null;
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

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Loads cache rows for the given dish names, keyed by normalised name.
 *
 * Fetched in chunks because the key list is a URL filter and a full week is
 * ~100 dishes. A failure here is not fatal: an empty map just means everything
 * looks new and gets regenerated.
 */
export async function loadDishCache(dishNames: string[]): Promise<Map<string, DishCacheEntry>> {
  const cache = new Map<string, DishCacheEntry>();
  const supabase = getClient();
  if (!supabase || dishNames.length === 0) return cache;

  const keys = Array.from(new Set(dishNames.map(normalizeDishName).filter(Boolean)));
  const CHUNK = 50;

  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("dish_cache")
      .select("cache_key, original_name, origin, description, image_path, image_nobg_path")
      .in("cache_key", slice);

    if (error) {
      console.warn(`⚠️  dish_cache read failed: ${error.message}`);
      continue;
    }

    for (const row of data ?? []) {
      cache.set(row.cache_key, {
        cacheKey: row.cache_key,
        originalName: row.original_name,
        origin: row.origin ?? null,
        description: row.description ?? null,
        imagePath: row.image_path ?? null,
        imageNoBgPath: row.image_nobg_path ?? null,
      });
    }
  }

  return cache;
}

/**
 * Writes entries back, merging rather than overwriting: a row that already has
 * a description must not lose it because this run only produced an image.
 */
export async function saveDishCacheEntries(entries: DishCacheEntry[]): Promise<number> {
  const supabase = getClient();
  if (!supabase || entries.length === 0) return 0;

  const rows = entries
    .filter((e) => e.cacheKey)
    .map((e) => {
      const row: Record<string, unknown> = {
        cache_key: e.cacheKey,
        original_name: e.originalName,
      };
      // Only include columns we actually have values for, so a partial update
      // cannot null out a field another run already filled in.
      if (e.origin) row.origin = e.origin;
      if (e.description) row.description = e.description;
      if (e.imagePath) row.image_path = e.imagePath;
      if (e.imageNoBgPath) row.image_nobg_path = e.imageNoBgPath;
      return row;
    });

  const { error } = await supabase.from("dish_cache").upsert(rows, { onConflict: "cache_key" });
  if (error) {
    console.warn(`⚠️  dish_cache write failed: ${error.message}`);
    return 0;
  }

  return rows.length;
}
