import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DishOrigin, DishDescription } from "../../lib/types.js";

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
 * Table shape:
 *   cache_key TEXT PRIMARY KEY, original_name, clean_name,
 *   origin JSONB, description JSONB, image_path, image_nobg_path, first_seen,
 *   enrich_attempts INTEGER, last_enrich_attempt TIMESTAMPTZ
 */

/** A cache row as stored. Every field is present, null where unfilled. */
export interface DishCacheRow {
  cacheKey: string;
  originalName: string;
  origin: DishOrigin | null;
  description: DishDescription | null;
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
  imagePath?: string | null;
  imageNoBgPath?: string | null;
  enrichAttempts?: number | null;
  lastEnrichAttempt?: string | null;
}

/**
 * How many times a dish may be sent to the model before the updater gives up
 * on it and renders the pattern fallback instead.
 *
 * The model answers for essentially every dish, so a dish that keeps coming
 * back empty is almost certainly not going to start working: a name mangled by
 * the scraper, or one the reply keys off differently every time. Five is above
 * the four runs a full-day outage costs (2 cron runs × 2 weekdays), and far
 * below the ~10 runs a dish would otherwise soak up during its week on the
 * menu — and it repeats every time that dish comes back.
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

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Cache rows keyed by normalised name, plus whether the read was trustworthy. */
export interface DishCacheLoad {
  rows: Map<string, DishCacheRow>;
  /**
   * True when at least one chunk could not be read.
   *
   * "The cache holds nothing for these dishes" and "I could not find out what
   * the cache holds" have to be different answers, for the same reason the
   * weekly_menus read distinguishes them: a caller that treats a failed read as
   * an empty result concludes every dish is new. Here that means re-asking the
   * model about a whole week that was already fully answered — and, worse,
   * recording a failed attempt against dishes that are perfectly fine.
   */
  failed: boolean;
}

/**
 * Loads cache rows for the given dish names, keyed by normalised name.
 *
 * Fetched in chunks because the key list is a URL filter and a full week is
 * ~100 dishes.
 */
export async function loadDishCache(dishNames: string[]): Promise<DishCacheLoad> {
  const cache = new Map<string, DishCacheRow>();
  const supabase = getClient();
  if (!supabase) return { rows: cache, failed: true };
  if (dishNames.length === 0) return { rows: cache, failed: false };

  const keys = Array.from(new Set(dishNames.map(normalizeDishName).filter(Boolean)));
  const CHUNK = 50;
  let failed = false;

  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("dish_cache")
      // One string literal, not a concatenation: supabase-js infers the row
      // type from the select at the type level, and `string` degrades it to an
      // error union that nothing type-checks against.
      // prettier-ignore
      .select("cache_key, original_name, origin, description, image_path, image_nobg_path, enrich_attempts, last_enrich_attempt")
      .in("cache_key", slice);

    if (error) {
      console.warn(`⚠️  dish_cache read failed: ${error.message}`);
      // One bad chunk poisons the whole answer: the caller cannot tell which
      // dishes are genuinely absent from a partial map.
      failed = true;
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
        enrichAttempts: row.enrich_attempts ?? 0,
        lastEnrichAttempt: row.last_enrich_attempt ?? null,
      });
    }
  }

  return { rows: cache, failed };
}

/**
 * Writes entries back, merging rather than overwriting: a row that already has
 * a description must not lose it because this run only produced an image.
 *
 * Omitting a key is *not* enough on its own. postgrest-js builds the request's
 * `columns` parameter from the union of the keys across the whole array
 * (@supabase/postgrest-js upsert(), `values.reduce(...Object.keys(x))`), and
 * without `Prefer: missing=default` PostgREST fills any listed column a given
 * row lacks with NULL. So one origin-only entry travelling alongside a
 * description-bearing one would blank that description — the exact data loss
 * this function's contract promises to prevent.
 *
 * Grouping by key signature and issuing one upsert per shape makes every batch
 * homogeneous, which is the only form where the union is what each row actually
 * carries.
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
      if (e.origin) row.origin = e.origin;
      if (e.description) row.description = e.description;
      if (e.imagePath) row.image_path = e.imagePath;
      if (e.imageNoBgPath) row.image_nobg_path = e.imageNoBgPath;
      // 0 is a meaningful value here (a dish that just succeeded), so test for
      // presence rather than truthiness.
      if (e.enrichAttempts !== undefined && e.enrichAttempts !== null) {
        row.enrich_attempts = e.enrichAttempts;
      }
      if (e.lastEnrichAttempt !== undefined) row.last_enrich_attempt = e.lastEnrichAttempt;
      return row;
    });

  // Deduplicate by key first. Two different dish names can normalise to the
  // same cache_key — "Kylling m/ ris" and "Kylling m ris" differ only in
  // punctuation the normaliser strips — and Postgres rejects an
  // INSERT ... ON CONFLICT whose proposed rows collide on the conflict target
  // ("cannot affect row a second time"). That aborts the *whole* statement, so
  // one such pair would silently discard every other dish in its batch.
  const deduped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = row.cache_key as string;
    // Merge rather than overwrite, so a later origin-only row cannot drop an
    // earlier description for the same key.
    deduped.set(key, { ...(deduped.get(key) ?? {}), ...row });
  }

  const byShape = new Map<string, Array<Record<string, unknown>>>();
  for (const row of deduped.values()) {
    const shape = Object.keys(row).sort().join(",");
    const group = byShape.get(shape);
    if (group) group.push(row);
    else byShape.set(shape, [row]);
  }

  let written = 0;
  for (const group of byShape.values()) {
    const { error } = await supabase.from("dish_cache").upsert(group, { onConflict: "cache_key" });
    if (error) {
      console.warn(`⚠️  dish_cache write failed: ${error.message}`);
      continue;
    }
    written += group.length;
  }

  return written;
}
