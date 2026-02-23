import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

interface AttendanceData {
  date: string;
  canteens: Record<string, number>;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

async function getAttendanceData(): Promise<AttendanceData> {
  try {
    const data = await redis.get<AttendanceData>('attendance');
    if (data) {
      return data;
    }
  } catch (err) {
    console.error('Error reading from Redis:', err);
  }
  return { date: getTodayKey(), canteens: {} };
}

async function saveAttendanceData(data: AttendanceData) {
  try {
    await redis.set('attendance', data);
  } catch (err) {
    console.error('Error writing to Redis:', err);
  }
}

export async function GET() {
  const data = await getAttendanceData();
  const today = getTodayKey();
  
  // Reset if it's a new day
  if (data.date !== today) {
    const newData = { date: today, canteens: {} };
    await saveAttendanceData(newData);
    return NextResponse.json(newData);
  }
  
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const { canteenName, action } = await request.json();
  
  if (!canteenName || !['add', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  
  const data = await getAttendanceData();
  const today = getTodayKey();
  
  // Reset if it's a new day
  if (data.date !== today) {
    data.date = today;
    data.canteens = {};
  }
  
  const currentCount = data.canteens[canteenName] || 0;
  
  if (action === 'add') {
    data.canteens[canteenName] = currentCount + 1;
  } else if (action === 'remove') {
    data.canteens[canteenName] = Math.max(0, currentCount - 1);
  }
  
  await saveAttendanceData(data);
  
  return NextResponse.json(data);
}
