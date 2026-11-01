import test from "node:test";
import assert from "node:assert/strict";
import {
  shouldTurn,
  recentVelocity,
  rubberBand,
  glideDuration,
  dragProgress,
  TURN_MIN_MS,
  TURN_MAX_MS,
  CANCEL_MAX_MS,
} from "./useDaySwipe";

const W = 390;

test("shouldTurn - a slow nudge never turns, however long it lasts", () => {
  assert.equal(shouldTurn(-34, -0.07, W), false);
  assert.equal(shouldTurn(-24, 0, W), false);
});

test("shouldTurn - a short quick flick turns, a drag past 15% turns", () => {
  assert.equal(shouldTurn(-70, -1, W), true);
  assert.equal(shouldTurn(-150, 0, W), true);
});

test("shouldTurn - a flick back against the displacement cancels", () => {
  assert.equal(shouldTurn(-100, 1.5, W), false);
});

test("recentVelocity - uses only the last stretch, and is zero after a pause", () => {
  const pts = [
    { x: 0, t: 0 },
    { x: 100, t: 50 },
    { x: 102, t: 200 },
    { x: 103, t: 250 },
  ];
  assert.ok(Math.abs(recentVelocity(pts, 260) - 0.02) < 1e-9);
  assert.equal(recentVelocity(pts, 600), 0);
});

test("rubberBand - follows the finger at first and never reaches the width", () => {
  assert.ok(rubberBand(10, W) > 9 * 0.9 * 0.35);
  assert.ok(rubberBand(10000, W) < W);
  assert.equal(rubberBand(-50, W), -rubberBand(50, W));
});

test("shouldTurn - a casual 70px swipe at a relaxed pace turns (measured: 0.36 px/ms)", () => {
  assert.equal(shouldTurn(-70, -0.36, W), true);
  assert.equal(shouldTurn(-30, -0.05, W), false);
});

test("glideDuration - a tap's full-width turn takes the longest a turn may, never more", () => {
  // A tap starts from rest (speed 0), so it covers the whole width at the floor
  // speed and is capped: a page turn never drags on past TURN_MAX_MS.
  assert.equal(glideDuration("turn", 406, 0), TURN_MAX_MS);
});

test("glideDuration - a fast flick finishes quickly, but never snaps", () => {
  assert.equal(glideDuration("turn", 200, 3), TURN_MIN_MS, "a 3 px/ms flick over 200px is floored, not 67ms");
  const medium = glideDuration("turn", 250, 1.5);
  assert.ok(medium > TURN_MIN_MS && medium < TURN_MAX_MS, `a middling release lands between, got ${medium}`);
});

test("glideDuration - a cancelled drag springs back faster than a turn", () => {
  assert.ok(glideDuration("cancel", 400, 0) <= CANCEL_MAX_MS);
  assert.ok(CANCEL_MAX_MS < TURN_MAX_MS);
});

test("dragProgress - follows the board, toward the next day as the board moves left", () => {
  assert.equal(dragProgress(0, 400), -0);
  assert.equal(dragProgress(-200, 400), 0.5);
  assert.equal(dragProgress(100, 400), -0.25);
  assert.equal(dragProgress(-900, 400), 1, "clamped: the dock never runs past the neighbour");
});
