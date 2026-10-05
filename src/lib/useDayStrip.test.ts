import test from "node:test";
import assert from "node:assert/strict";
import { nearestDay } from "./useDayStrip";

// Five panels 390px wide with a 16px gap: each starts 406px after the last.
const LEFTS = [0, 406, 812, 1218, 1624];

test("nearestDay - rests on the panel whose start is closest", () => {
  assert.equal(nearestDay(0, LEFTS), 0);
  assert.equal(nearestDay(406, LEFTS), 1);
  assert.equal(nearestDay(1624, LEFTS), 4);
});

test("nearestDay - flips at the midpoint, ties stay on the earlier day", () => {
  assert.equal(nearestDay(203, LEFTS), 0);
  assert.equal(nearestDay(204, LEFTS), 1);
});

test("nearestDay - overscroll past either end clamps to the first or last day", () => {
  assert.equal(nearestDay(-60, LEFTS), 0);
  assert.equal(nearestDay(5000, LEFTS), 4);
});

test("nearestDay - no panels yet means day 0", () => {
  assert.equal(nearestDay(120, []), 0);
});
