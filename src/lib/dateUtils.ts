/**
 * Shared date utilities — single source of truth for date keys, week numbers,
 * and the display context (which week we render and how we present it).
 * Uses Europe/Oslo timezone consistently across client and server.
 */

const TZ = 'Europe/Oslo';

/** Returns today's date as YYYY-MM-DD in Europe/Oslo timezone. */
export function getLocalDateKey(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

/** Today's date components in Europe/Oslo timezone. */
function todayOsloParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return {
    year: Number(parts.find(p => p.type === 'year')!.value),
    month: Number(parts.find(p => p.type === 'month')!.value),
    day: Number(parts.find(p => p.type === 'day')!.value),
  };
}

/** ISO 8601 week number for a given calendar date. */
export function getWeekNumberForDate(year: number, month: number, day: number): number {
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/** Returns the ISO 8601 week number for today (Europe/Oslo timezone). */
export function getWeekNumber(): number {
  const { year, month, day } = todayOsloParts();
  return getWeekNumberForDate(year, month, day);
}

/**
 * ISO 8601 week-numbering year — the calendar year containing that week's
 * Thursday. This is NOT always the calendar year: 2027-01-01 falls in week 53
 * of week-year 2026, and 2029-12-31 falls in week 1 of week-year 2030. Pairing
 * a calendar year with an ISO week number silently produces the wrong id on
 * those boundary days.
 */
export function getIsoWeekYearForDate(year: number, month: number, day: number): number {
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  // Step to the Thursday of this ISO week; its calendar year is the week-year.
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  return d.getFullYear();
}

/**
 * Canonical id for a week, e.g. "2026-W34". Used as the primary key of the
 * Supabase `weekly_menus` table, so it must be stable and zero-padded.
 */
export function getWeekIdForDate(year: number, month: number, day: number): string {
  const weekNum = getWeekNumberForDate(year, month, day);
  const weekYear = getIsoWeekYearForDate(year, month, day);
  return `${weekYear}-W${String(weekNum).padStart(2, '0')}`;
}

/** Canonical id for the current week (Europe/Oslo timezone). */
export function getWeekId(): string {
  const { year, month, day } = todayOsloParts();
  return getWeekIdForDate(year, month, day);
}

/**
 * Compare two ISO week numbers with year-wrap handling.
 * Returns 1 if `a` is ahead of `b`, -1 if behind, 0 if same.
 *
 * Around year boundaries, raw `<` / `>` is wrong: in week 52, a canteen
 * showing week 1 is *ahead* (next year), not behind. We treat differences
 * larger than 26 as wrapping the year.
 */
export function compareWeeks(a: number, b: number): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a > b) return a - b <= 26 ? 1 : -1;
  return b - a <= 26 ? -1 : 1;
}

export type DisplayMode = 'weekday-current' | 'weekend-preview' | 'weekend-recap';

export interface DisplayContext {
  /** Monday of the displayed week (local TZ Date used only for date math). */
  anchor: Date;
  /** ISO week number of the anchor. */
  weekNumber: number;
  /** 0..4 if today is Mon..Fri AND matches anchor + i, else -1. */
  todayIndex: number;
  /** Day index (0..4) the UI should land on by default. */
  defaultSelectedDay: number;
  /** Drives header copy, banner, and voting affordances. */
  mode: DisplayMode;
}

/**
 * Single source of truth for which week to display. Resolves the calendar
 * (today in Oslo) against the data (canteen week numbers) into a coherent
 * mode + anchor so weekLabel and date strip can never disagree.
 *
 * Pass the parsed week numbers from canteen.week. Empty array → treated as
 * "no data yet" (defaults to weekday-current / weekend-recap).
 */
export function computeDisplayContext(canteenWeekNumbers: number[]): DisplayContext {
  const { year, month, day } = todayOsloParts();
  // Local-TZ Date that matches Oslo's calendar day. Noon avoids DST edges.
  const today = new Date(year, month - 1, day, 12, 0, 0);
  const dayOfWeek = today.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + mondayOffset);

  const currentWeek = getWeekNumberForDate(year, month, day);

  if (!isWeekend) {
    return {
      anchor: thisMonday,
      weekNumber: currentWeek,
      todayIndex: dayOfWeek - 1,
      defaultSelectedDay: dayOfWeek - 1,
      mode: 'weekday-current',
    };
  }

  // Enter preview only when EVERY canteen has next-week data — otherwise
  // a single early-publishing canteen would hide the rest behind dates
  // that don't apply to them. Year-wrap aware so week 52 → 1 still reads
  // as "ahead".
  const allAhead =
    canteenWeekNumbers.length > 0 &&
    canteenWeekNumbers.every(w => compareWeeks(w, currentWeek) === 1);

  if (allAhead) {
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    return {
      anchor: nextMonday,
      weekNumber: getWeekNumberForDate(
        nextMonday.getFullYear(),
        nextMonday.getMonth() + 1,
        nextMonday.getDate(),
      ),
      todayIndex: -1,
      defaultSelectedDay: 0,
      mode: 'weekend-preview',
    };
  }

  return {
    anchor: thisMonday,
    weekNumber: currentWeek,
    todayIndex: -1,
    defaultSelectedDay: 4,
    mode: 'weekend-recap',
  };
}
