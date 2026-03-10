import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export async function DELETE() {
  const deleted: string[] = [];

  // Scan and delete all cached keys by prefix
  const prefixes = ['meny:', 'prices:', 'recipe:', 'deals:'];

  for (const prefix of prefixes) {
    let cursor = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 100 });
      cursor = typeof nextCursor === 'string' ? parseInt(nextCursor, 10) : nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted.push(...keys.map(k => String(k)));
      }
    } while (cursor !== 0);
  }

  return NextResponse.json({
    cleared: deleted.length,
    keys: deleted,
    localStorageKeys: ['recipe_v2_*', 'deals_v2_*', 'meny_v1_*'],
    message: 'Redis cache cleared. Clear localStorage in browser: Object.keys(localStorage).filter(k => k.startsWith("recipe_v2_") || k.startsWith("deals_v2_") || k.startsWith("meny_v1_")).forEach(k => localStorage.removeItem(k))',
  });
}
