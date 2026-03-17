import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

function getLast14UtcDays(): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 14; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

export async function GET() {
  const dates = getLast14UtcDays();
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
