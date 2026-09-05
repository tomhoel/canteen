import { Redis } from "@upstash/redis";

/**
 * The one place that decides whether a Redis cache is available.
 *
 * There were four copies of this function and they did not agree. The menu
 * cache accepted either `UPSTASH_REDIS_REST_*` or `KV_REST_API_*`; the deals,
 * meny, recipe and attendance paths accepted only `KV_REST_API_*`; and
 * .env.example documented only `UPSTASH_REDIS_REST_*`. A deployment that
 * followed the documentation got a working menu cache and silently no caching
 * anywhere else — every grocery search and recipe re-billed the model and the
 * upstream API on a cache the code had quietly decided not to use.
 *
 * Both namings are real: the Upstash marketplace integration provisions
 * `UPSTASH_REDIS_REST_*`, while the older Vercel KV integration provisions
 * `KV_REST_API_*`, and a project that has migrated may carry both. Accepting
 * either everywhere is the only version of this with no wrong answer.
 *
 * Returns null rather than throwing: every caller treats the cache as optional
 * and falls back to its origin, which is why the misconfiguration was invisible
 * for so long.
 */
export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

/**
 * Bumped whenever the *shape* of a cached `/api/menu` response changes.
 *
 * The cache stores a whole serialised `WeeklyMenuResponse` under a key derived
 * only from the week. So when a field is added to that interface, every entry
 * written by the previous deploy is still a cache hit — and is returned
 * verbatim, missing the new field, with nothing thrown and nothing logged. The
 * client then falls back as if the server had never been changed.
 *
 * That is not hypothetical. Adding `weekId` shipped green through CI and a
 * successful production deploy, and the field was still absent from
 * fbueat.vercel.app for the whole TTL, because `response:menu:current` had been
 * written minutes earlier by the old code.
 *
 * Versioning the key makes a shape change self-invalidating: old entries become
 * unreachable at once and age out on their own TTL. Bump this in the same
 * commit that changes `WeeklyMenuResponse`.
 */
export const MENU_RESPONSE_SHAPE = "v2";

/**
 * The cache key for one week's `/api/menu` response.
 *
 * Exists because four call sites across two files each built this string
 * themselves — the read, the write, `invalidateMenuResponseCache`, and the
 * update loop's own `del`. Any one of them disagreeing about the format means a
 * write nothing reads, or an invalidation that clears nothing, and neither
 * fails loudly. That is the same bug this file's `getRedis` comment describes,
 * one layer up.
 *
 * `weekId` omitted means the "serve whatever is current" request, which is what
 * the app asks for on every load.
 */
export function menuResponseKey(weekId?: string): string {
  return `response:menu:${MENU_RESPONSE_SHAPE}:${weekId || "current"}`;
}
