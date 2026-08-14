import test from "node:test";
import assert from "node:assert/strict";
import {
  getWeekNumberForDate,
  getIsoWeekYearForDate,
  getWeekIdForDate,
  compareWeeks,
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
