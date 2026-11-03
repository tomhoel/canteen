import test from "node:test";
import assert from "node:assert/strict";
import { dayPosition } from "./useDayScroller";

test("dayPosition - whole days at each snap point, fractions in between", () => {
  assert.equal(dayPosition(0, 406), 0);
  assert.equal(dayPosition(406 * 2, 406), 2);
  assert.equal(dayPosition(406 * 2.5, 406), 2.5);
});

test("dayPosition - an edge bounce never reports a day outside the week", () => {
  assert.equal(dayPosition(-60, 406), 0);
  assert.equal(dayPosition(406 * 4 + 80, 406), 4);
});

test("dayPosition - a scroller not laid out yet reads as Monday, not NaN", () => {
  assert.equal(dayPosition(100, 0), 0);
});
