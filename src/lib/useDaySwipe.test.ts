import test from "node:test";
import assert from "node:assert/strict";
import { shouldTurn, recentVelocity, rubberBand } from "./useDaySwipe";

const W = 390;

test("shouldTurn - a slow nudge never turns, however long it lasts", () => {
  assert.equal(shouldTurn(-34, -0.07, W), false);
  assert.equal(shouldTurn(-24, 0, W), false);
});

test("shouldTurn - a short quick flick turns, a drag past a quarter turns", () => {
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
  assert.equal(shouldTurn(-60, -0.15, W), false);
});
