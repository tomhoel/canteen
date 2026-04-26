import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getLocalDateKey } from '@/lib/dateUtils';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

/** Generate last 14 days using the same Oslo timezone as the main attendance route. */
function getLast14Days(): string[] {
  // Start from today's date in Oslo timezone
  const todayStr = getLocalDateKey(); // YYYY-MM-DD
  const [y, m, d] = todayStr.split('-').map(Number);
  const today = new Date(y, m - 1, d);

  const dates: string[] = [];
  for (let i = 1; i <= 14; i++) {
    const past = new Date(today);
    past.setDate(today.getDate() - i);
    const yyyy = past.getFullYear();
    const mm = String(past.getMonth() + 1).padStart(2, '0');
    const dd = String(past.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

export async function GET() {
  const dates = getLast14Days();
  const keys = dates.map(d => `attendance:${d}`);

  try {
    const results = await redis.mget<Array<{ date: string; canteens: Record<string, number> } | null>>(...keys);
    const entries = results.filter(
      (r): r is { date: string; canteens: Record<string, number> } =>
        r !== null &&
        typeof r === 'object' &&
        Object.values(r.canteens || {}).some(v => v > 0)
    );
    return NextResponse.json({ entries });
  } catch (err) {
    console.error('Error reading attendance history:', err);
    return NextResponse.json({ entries: [] });
  }
}
