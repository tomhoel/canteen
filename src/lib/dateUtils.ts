/**
 * Shared date utilities — single source of truth for date keys, week numbers,
 * and the display context (which week we render and how we present it).
 * Uses Europe/Oslo timezone consistently across client and server.
 */

import { getISOWeek, getISOWeekYear, addDays, format } from "date-fns";

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

/** ISO 8601 week number for a given calendar date (Europe/Oslo noon anchor). */
export function getWeekNumberForDate(year: number, month: number, day: number): number {
  return getISOWeek(new Date(year, month - 1, day, 12, 0, 0));
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
  return getISOWeekYear(new Date(year, month - 1, day, 12, 0, 0));
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
 * Saturday or Sunday in Europe/Oslo.
 *
 * The read path needs this to decide whether to serve next week's row, and it
 * has to agree with computeDisplayContext's own weekend test — which is derived
 * from the same Oslo parts, not from the server's local clock. A server in UTC
 * asking `new Date().getDay()` would flip to Monday two hours after Oslo does,
 * and spend those two hours serving a week the UI would not be in preview mode
 * for.
 */
export function isOsloWeekend(): boolean {
  const { year, month, day } = todayOsloParts();
  const dayOfWeek = new Date(year, month - 1, day, 12, 0, 0).getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

/** Canonical id for the week `weeks` weeks from today, e.g. 1 for next week. */
export function getWeekIdOffset(weeks: number): string {
  const { year, month, day } = todayOsloParts();
  // Noon so the ±7-day step cannot land on a DST boundary and shift the date.
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() + weeks * 7);
  return getWeekIdForDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/**
 * Whether a set of canteens has all moved on to a week after `currentWeek`.
 *
 * The predicate `computeDisplayContext` uses to choose between weekend-preview
 * and weekend-recap. The read path now does serve next week's row from Saturday
 * (`readWeekForDisplay` in src/server/menu.ts) — which is what makes this test
 * satisfiable at all. Between the week-routing fix and that change, every row
 * held canteens labelled with its own week, so a weekend request could only
 * ever produce labels equal to the current week and preview was unreachable.
 * If the two ever
 * disagreed the app would render one week's food under the other week's dates,
 * which is the specific failure the display context exists to prevent.
 */
export function allCanteensAhead(canteenWeekNumbers: number[], currentWeek: number): boolean {
  return (
    canteenWeekNumbers.length > 0 &&
    canteenWeekNumbers.every(w => compareWeeks(w, currentWeek) === 1)
  );
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

/**
 * The week number a canteen says its menu is for, or null if the label has none.
 *
 * Anchored to the word "uke"/"week" rather than taking the first digits in the
 * string: Flow's label is "Bygg / Building M - Uke/Week 33", and a building
 * number would otherwise win. Falls back to a bare 1-2 digit number so an
 * unadorned "34" still parses.
 *
 * `(?!\d)` on the capture stops a longer run being silently truncated: without
 * it "Uke 2026" reads as week 20. A label we cannot read confidently is worth
 * more as `null` — the caller falls back to the calendar week — than as a
 * plausible-looking wrong number, which routes a canteen's whole menu into a
 * row nothing displays.
 */
export function parseCanteenWeekNumber(label: string | undefined | null): number | null {
  if (!label) return null;
  const tagged = label.match(/(?:uke|week)[\s/]*(?:uke|week)?[\s:-]*(\d{1,2})(?!\d)/i);
  const raw = tagged?.[1] ?? label.match(/\b(\d{1,2})\b/)?.[1];
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 53 ? n : null;
}

/**
 * Signed distance in weeks from `b` to `a`, year-wrap aware. `+2` means `a` is
 * two weeks ahead of `b`; week 1 is one week ahead of week 52, not 51 behind.
 *
 * Exists so callers can sanity-check a parsed week number before trusting it.
 * `parseCanteenWeekNumber` accepts anything in 1..53, which is right for a
 * label that genuinely says "week 3" — but a canteen cannot plausibly be
 * publishing thirty weeks from now, so a number that far out is a misread.
 */
export function weekDistance(a: number, b: number): number {
  if (a === b) return 0;
  const raw = Math.abs(a - b);
  // A year is 52 or 53 weeks, and this does not know which, so the wrapped
  // magnitude can come out one short: week 1 is one week after week 53, but
  // `52 - 52` says zero. Clamping to 1 keeps "different weeks are at least one
  // week apart" true, which is the only property callers rely on.
  return compareWeeks(a, b) * Math.max(1, Math.min(raw, 52 - raw));
}

/**
 * Canonical week id for a week number a canteen published, e.g. 34 -> "2026-W34".
 *
 * The week-year is resolved against today rather than assumed, because a canteen
 * publishing "week 1" during week 52 means *next* year. compareWeeks already
 * encodes that wrap rule; this only has to apply the resulting direction.
 */
export function weekIdForWeekNumber(weekNumber: number): string {
  const { year, month, day } = todayOsloParts();
  const currentWeek = getWeekNumberForDate(year, month, day);
  let weekYear = getIsoWeekYearForDate(year, month, day);

  const direction = compareWeeks(weekNumber, currentWeek);
  // Only a wrap moves the year: ahead but numerically smaller, or behind but
  // numerically larger. A normal ahead/behind stays inside the same week-year.
  if (direction === 1 && weekNumber < currentWeek) weekYear += 1;
  if (direction === -1 && weekNumber > currentWeek) weekYear -= 1;

  return `${weekYear}-W${String(weekNumber).padStart(2, '0')}`;
}

/**
 * Monday of a canonical week id, or null if the id is not one.
 *
 * ISO week 1 is the week containing 4 January, so that date's Monday anchors
 * the year and every other week is a multiple of seven days from it.
 */
export function mondayOfWeekId(weekId: string | undefined | null): Date | null {
  const match = weekId?.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return null;

  const weekYear = Number(match[1]);
  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > 53) return null;

  // Noon, so adding whole days can never be shifted by a DST transition.
  const jan4 = new Date(weekYear, 0, 4, 12, 0, 0);
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));

  const monday = new Date(week1Monday);
  monday.setDate(week1Monday.getDate() + (weekNumber - 1) * 7);
  return monday;
}

/**
 * The five short date labels ("18.08") of the week starting at `anchorMonday`.
 *
 * Shared by the header, the day bar and the loading screen so the placeholder
 * shell and the loaded app can never print different dates for the same week.
 */
export function weekDayLabels(anchorMonday: Date): string[] {
  return Array.from({ length: 5 }, (_, i) => format(addDays(anchorMonday, i), 'dd.MM'));
}

/** The long-form date ("18. august") of day `dayIndex` of that same week. */
export function formatLongDate(
  anchorMonday: Date,
  dayIndex: number,
  lang: 'no' | 'en',
): string {
  const d = addDays(anchorMonday, dayIndex);
  return d.toLocaleDateString(lang === 'no' ? 'nb-NO' : 'en-GB', {
    day: 'numeric',
    month: 'long',
  });
}

export type DisplayMode = 'weekday-current' | 'weekend-preview' | 'weekend-recap' | 'pinned-week';

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
 *
 * `pinnedWeekId` is the `?week=` search param. Without it this function derives
 * everything from today, which is right for the normal case and wrong the
 * moment the app is asked for a specific week: it would render that week's food
 * under this week's dates, with a "today" that is not in the week on screen.
 * A pinned week that happens to be the current one falls through to the normal
 * rules, so linking to the current week changes nothing.
 */
export function computeDisplayContext(
  canteenWeekNumbers: number[],
  pinnedWeekId?: string,
): DisplayContext {
  const { year, month, day } = todayOsloParts();
  // Local-TZ Date that matches Oslo's calendar day. Noon avoids DST edges.
  const today = new Date(year, month - 1, day, 12, 0, 0);

  const pinnedMonday =
    pinnedWeekId && pinnedWeekId !== getWeekIdForDate(year, month, day)
      ? mondayOfWeekId(pinnedWeekId)
      : null;

  if (pinnedMonday) {
    return {
      anchor: pinnedMonday,
      weekNumber: getWeekNumberForDate(
        pinnedMonday.getFullYear(),
        pinnedMonday.getMonth() + 1,
        pinnedMonday.getDate(),
      ),
      // Today is not in the week being shown, so nothing is "today" and the
      // week opens on its Monday. Voting keys off weekday-current and stays
      // off, which is correct: you cannot vote on a lunch you are not at.
      todayIndex: -1,
      defaultSelectedDay: 0,
      mode: 'pinned-week',
    };
  }
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
  if (allCanteensAhead(canteenWeekNumbers, currentWeek)) {
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
