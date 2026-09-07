import test from "node:test";
import assert from "node:assert/strict";
import { springPoints } from "./spring-easing.js";

/** The day strip's settle, exactly as useDaySwipe asks motion for it today. */
const SETTLE = { stiffness: 380, damping: 40, mass: 0.7 };

test("the settle spring is over-damped, so the closed form applies", () => {
  const zeta = SETTLE.damping / (2 * Math.sqrt(SETTLE.stiffness * SETTLE.mass));
  assert.ok(zeta > 1, `expected over-damped, got zeta=${zeta}`);
});

test("a release with velocity carries past the start before turning back", () => {
  // The whole reason this module exists, and the one thing a cubic-bezier
  // cannot express. A hard flick leaves the strip at -100px still moving at
  // -1500px/s; the spring travels FURTHER out before coming home, which shows
  // up as negative progress early in the curve.
  const { points } = springPoints(SETTLE, -100, -1500);
  assert.ok(
    points.some((v) => v < 0),
    "expected the carry to appear as progress < 0"
  );
  assert.equal(points[0], 0, "must start exactly at the drag position");
  assert.equal(points[points.length - 1], 1, "must land exactly home");
});

test("a release from rest never goes backwards", () => {
  const { points } = springPoints(SETTLE, -120, 0);
  assert.ok(
    points.every((v) => v >= 0),
    "a spring released at rest is monotone; no sample may be negative"
  );
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i] >= points[i - 1], `sample ${i} went backwards`);
  }
});

test("a harder flick carries further than a softer one", () => {
  const carry = (v: number) => springPoints(SETTLE, -100, v).points[1];
  assert.ok(
    carry(-1500) < carry(-800),
    "more release velocity must mean more carry"
  );
});

test("dragging the other way carries the other way, symmetrically", () => {
  const left = springPoints(SETTLE, -100, -1500).points;
  const right = springPoints(SETTLE, 100, 1500).points;
  for (let i = 0; i < left.length; i++) {
    assert.ok(
      Math.abs(left[i] - right[i]) < 1e-9,
      `progress must not depend on drag direction (sample ${i})`
    );
  }
});

test("a settle from zero asks for no animation at all", () => {
  assert.equal(springPoints(SETTLE, 0, 0).durationMs, 0);
});

test("the settle lands in a plausible duration", () => {
  const { durationMs } = springPoints(SETTLE, -100, -1500);
  assert.ok(durationMs > 100 && durationMs < 1200, `got ${durationMs}ms`);
});

test("progress is bounded either side of the target", () => {
  // linear() accepts values outside [0, 1], but a wild sample would mean the
  // solution is wrong rather than that the spring overshot.
  const { points } = springPoints(SETTLE, -100, -1500);
  assert.ok(Math.min(...points) > -0.5, "carry is a nudge, not a bounce");
  assert.ok(Math.max(...points) <= 1 + 1e-9, "an over-damped spring never passes home");
});
