import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';

export const dynamic = 'force-dynamic';

const ATTENDANCE_FILE = '/tmp/attendance.json';

interface AttendanceData {
  date: string;
  canteens: Record<string, number>;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function readAttendance(): AttendanceData {
  try {
    const data = fs.readFileSync(ATTENDANCE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { date: getTodayKey(), canteens: {} };
  }
}

function writeAttendance(data: AttendanceData) {
  fs.writeFileSync(ATTENDANCE_FILE, JSON.stringify(data, null, 2));
}

export async function GET() {
  const data = readAttendance();
  const today = getTodayKey();
  
  // Reset if it's a new day
  if (data.date !== today) {
    const newData = { date: today, canteens: {} };
    writeAttendance(newData);
    return NextResponse.json(newData);
  }
  
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const { canteenName, action } = await request.json();
  
  if (!canteenName || !['add', 'remove'].includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  
  const data = readAttendance();
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
  
  writeAttendance(data);
  
  return NextResponse.json(data);
}
