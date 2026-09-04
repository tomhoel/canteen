import test from "node:test";
import assert from "node:assert/strict";
import {
  getWeekNumberForDate,
  getIsoWeekYearForDate,
  getWeekIdForDate,
  compareWeeks,
  parseCanteenWeekNumber,
  weekIdForWeekNumber,
  weekDistance,
  getWeekId,
  getWeekIdOffset,
  allCanteensAhead,
  mondayOfWeekId,
  computeDisplayContext,
  weekDayLabels,
  formatLongDate,
} from "./dateUtils";

test("getWeekNumberForDate - ordinary mid-year date", () => {
  // Fri 14 Aug 2026 — the week the app was showing as "Uke 33".
  assert.equal(getWeekNumberForDate(2026, 8, 14), 33);
});

test("getIsoWeekYearForDate - week-year differs from calendar year in January", () => {
  // Fri 1 Jan 2027 sits in the ISO week whose Thursday is 31 Dec 2026,
  // so it belongs to week-year 2026, not 2027.
  assert.equal(getIsoWeekYearForDate(2027, 1, 1), 2026);
});

test("getIsoWeekYearForDate - week-year differs from calendar year in December", () => {
  // Mon 29 Dec 2025 sits in the week whose Thursday is 1 Jan 2026.
  assert.equal(getIsoWeekYearForDate(2025, 12, 29), 2026);
});

test("getWeekIdForDate - zero-pads single-digit weeks", () => {
  assert.equal(getWeekIdForDate(2026, 1, 5), "2026-W02");
});

test("getWeekIdForDate - new year's day rolls back into the previous week-year", () => {
  // The regression that the hardcoded `2026-` prefix would have produced:
  // this must be 2026-W53, never 2027-W53.
  assert.equal(getWeekIdForDate(2027, 1, 1), "2026-W53");
});

test("getWeekIdForDate - late December rolls forward into the next week-year", () => {
  assert.equal(getWeekIdForDate(2025, 12, 29), "2026-W01");
});

test("getWeekIdForDate - is stable across a whole ISO week", () => {
  // Mon 10 Aug 2026 through Sun 16 Aug 2026 must all map to one id.
  const ids = [10, 11, 12, 13, 14, 15, 16].map((d) => getWeekIdForDate(2026, 8, d));
  assert.deepEqual(new Set(ids), new Set(["2026-W33"]));
});

test("compareWeeks - handles the year wrap", () => {
  // In week 52, a canteen advertising week 1 is ahead, not 51 weeks behind.
  assert.equal(compareWeeks(1, 52), 1);
  assert.equal(compareWeeks(52, 1), -1);
  assert.equal(compareWeeks(34, 33), 1);
  assert.equal(compareWeeks(33, 33), 0);
});

test("parseCanteenWeekNumber - reads the real labels the canteens publish", () => {
  assert.equal(parseCanteenWeekNumber("UKE/WEEK 33"), 33);
  assert.equal(parseCanteenWeekNumber("Uke/week 34"), 34);
  assert.equal(parseCanteenWeekNumber("UKE 7"), 7);
  assert.equal(parseCanteenWeekNumber("Week: 12"), 12);
});

test("parseCanteenWeekNumber - anchors to the word, not the first digits", () => {
  // Flow's label carries a building name. Taking the first number in the
  // string would key the whole week off "Building 2".
  assert.equal(parseCanteenWeekNumber("BYGG / BUILDING M - UKE/WEEK 33"), 33);
  assert.equal(parseCanteenWeekNumber("Bygg 2 / Building 2 - Uke/Week 41"), 41);
});

test("parseCanteenWeekNumber - rejects labels with no usable number", () => {
  assert.equal(parseCanteenWeekNumber("Unknown"), null);
  assert.equal(parseCanteenWeekNumber(""), null);
  assert.equal(parseCanteenWeekNumber(undefined), null);
  // Out of range for an ISO week.
  assert.equal(parseCanteenWeekNumber("uke 54"), null);
});

test("weekIdForWeekNumber - the current week resolves to today's week id", () => {
  const current = Number(getWeekId().slice(-2));
  assert.equal(weekIdForWeekNumber(current), getWeekId());
});

test("weekIdForWeekNumber - zero-pads to match the primary key format", () => {
  assert.match(weekIdForWeekNumber(7), /^\d{4}-W07$/);
});

test("weekIdForWeekNumber - a canteen one week ahead stays in the same week-year", () => {
  const [year, w] = getWeekId().split("-W");
  const next = Number(w) + 1;
  // Skip the genuine year-end wrap, which the next test covers directly.
  if (next <= 52) {
    assert.equal(weekIdForWeekNumber(next), `${year}-W${String(next).padStart(2, "0")}`);
  }
});

test("parseCanteenWeekNumber - does not truncate a longer run of digits", () => {
  // "Uke 2026" reading as week 20 is worse than reading as nothing: a plausible
  // wrong number routes a canteen's whole menu into a row nothing displays,
  // while null falls back to the calendar week and the menu still shows up.
  assert.equal(parseCanteenWeekNumber("Uke 2026"), null);
  assert.equal(parseCanteenWeekNumber("Uke/Week 335"), null);
  assert.equal(parseCanteenWeekNumber("Uke 33 2026"), 33);
});

test("weekDistance - measures how far apart two week numbers are", () => {
  assert.equal(weekDistance(33, 33), 0);
  assert.equal(weekDistance(34, 33), 1);
  assert.equal(weekDistance(32, 33), -1);
  // Not "thirty weeks behind": week 3 in August is next year, and either way
  // it is nowhere near a week a canteen could plausibly be publishing.
  assert.ok(Math.abs(weekDistance(3, 33)) > 2);
});

test("weekDistance - week 1 is one week ahead of week 52, not fifty-one behind", () => {
  assert.equal(weekDistance(1, 52), 1);
  assert.equal(weekDistance(52, 1), -1);
});

test("weekDistance - two different weeks are never zero apart", () => {
  // 2026 is a 53-week ISO year, so week 1 follows week 53. The wrap arithmetic
  // does not know the year's length and would otherwise report them as the
  // same week.
  assert.equal(weekDistance(1, 53), 1);
  assert.equal(weekDistance(53, 1), -1);
  for (let a = 1; a <= 53; a++) {
    for (let b = 1; b <= 53; b++) {
      if (a === b) continue;
      assert.notEqual(weekDistance(a, b), 0, `weekDistance(${a}, ${b}) collapsed to zero`);
    }
  }
});

test("getWeekIdOffset - zero is today's week, one is next week", () => {
  assert.equal(getWeekIdOffset(0), getWeekId());
  assert.notEqual(getWeekIdOffset(1), getWeekId());
  assert.match(getWeekIdOffset(1), /^\d{4}-W\d{2}$/);
});

test("getWeekIdOffset - three consecutive weeks are three distinct, ordered ids", () => {
  const ids = [getWeekIdOffset(-1), getWeekIdOffset(0), getWeekIdOffset(1)];
  assert.equal(new Set(ids).size, 3);
  // Not a lexical sort in general — week 52 → 1 crosses a year — but the ids
  // carry their own week-year, so string order and calendar order agree.
  assert.deepEqual([...ids].sort(), ids);
});

test("allCanteensAhead - needs every canteen, not just one early publisher", () => {
  assert.equal(allCanteensAhead([34, 34, 34], 33), true);
  assert.equal(allCanteensAhead([33, 34, 34], 33), false);
  assert.equal(allCanteensAhead([], 33), false, "no data is not a preview");
  // Year wrap: in week 52, a canteen showing week 1 is ahead.
  assert.equal(allCanteensAhead([1, 1], 52), true);
});

test("mondayOfWeekId - resolves to a Monday whose own week id round-trips", () => {
  for (const weekId of ["2026-W01", "2026-W33", "2026-W53", "2027-W01", "2029-W52"]) {
    const monday = mondayOfWeekId(weekId)!;
    assert.ok(monday, `no Monday for ${weekId}`);
    assert.equal(monday.getDay(), 1, `${weekId} did not land on a Monday`);
    assert.equal(
      getWeekIdForDate(monday.getFullYear(), monday.getMonth() + 1, monday.getDate()),
      weekId,
      `${weekId} did not round-trip`
    );
  }
});

test("mondayOfWeekId - rejects anything that is not a week id", () => {
  for (const bad of ["2026-W", "2026-W00", "2026-W54", "26-W33", "next week", "", undefined]) {
    assert.equal(mondayOfWeekId(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("computeDisplayContext - a pinned week anchors on that week, not on today", () => {
  // Without this the app renders one week's food under another week's dates,
  // with a "today" that is not in the week on screen.
  const pinned = getWeekIdOffset(3);
  const ctx = computeDisplayContext([], pinned);

  assert.equal(ctx.mode, "pinned-week");
  assert.equal(ctx.todayIndex, -1, "nothing in a future week is today");
  assert.equal(ctx.defaultSelectedDay, 0, "it opens on its Monday");
  assert.equal(
    getWeekIdForDate(ctx.anchor.getFullYear(), ctx.anchor.getMonth() + 1, ctx.anchor.getDate()),
    pinned
  );
  assert.equal(ctx.weekNumber, Number(pinned.slice(-2)));
});

test("computeDisplayContext - pinning the current week changes nothing", () => {
  const plain = computeDisplayContext([]);
  const pinned = computeDisplayContext([], getWeekId());

  assert.equal(pinned.mode, plain.mode);
  assert.equal(pinned.todayIndex, plain.todayIndex);
  assert.equal(pinned.defaultSelectedDay, plain.defaultSelectedDay);
  assert.equal(pinned.weekNumber, plain.weekNumber);
});

test("computeDisplayContext - an unparseable week param is ignored, not obeyed", () => {
  const plain = computeDisplayContext([]);
  const junk = computeDisplayContext([], "not-a-week");

  assert.equal(junk.mode, plain.mode);
  assert.equal(junk.weekNumber, plain.weekNumber);
});

test("weekDayLabels - produces 5 zero-padded day.month strings", () => {
  const monday = new Date(2026, 7, 17, 12, 0, 0); // 17 Aug 2026
  const labels = weekDayLabels(monday);
  assert.deepEqual(labels, ["17.08", "18.08", "19.08", "20.08", "21.08"]);
});

test("formatLongDate - formats long date for Norwegian and English", () => {
  const monday = new Date(2026, 7, 17, 12, 0, 0); // 17 Aug 2026
  const no = formatLongDate(monday, 1, "no"); // Tuesday 18 August
  const en = formatLongDate(monday, 1, "en");
  assert.match(no, /18\.\s*august/i);
  assert.match(en, /18\s*August/i);
});

