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
