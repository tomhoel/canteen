import test from "node:test";
import assert from "node:assert/strict";
import { shouldDismiss, shouldEngage, shouldTurnPage } from "./sheet-drag";

test("shouldEngage — does NOT engage at zero movement, but does not cancel either", () => {
  assert.equal(shouldEngage({ atTop: true, engaged: false, my: 0 }), false);
  assert.equal(shouldEngage({ atTop: true, engaged: false, my: 4 }), true);
});

test("shouldEngage — survives a small upward wobble before downward pull", () => {
  assert.equal(shouldEngage({ atTop: true, engaged: false, my: -3 }), false);
  assert.equal(shouldEngage({ atTop: true, engaged: false, my: 12 }), true);
});

test("shouldEngage — leaves touch alone when body still has somewhere to scroll", () => {
  assert.equal(shouldEngage({ atTop: false, engaged: false, my: 200 }), false);
});

test("shouldEngage — never takes over an upward drag", () => {
  assert.equal(shouldEngage({ atTop: true, engaged: false, my: -80 }), false);
});

test("shouldEngage — once engaged it stays engaged even as finger moves back up slightly", () => {
  assert.equal(shouldEngage({ atTop: true, engaged: true, my: -50 }), true);
  assert.equal(shouldEngage({ atTop: false, engaged: true, my: 10 }), true);
});

test("shouldDismiss — closes past a quarter of the panel height", () => {
  const opts = { height: 400, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldDismiss({ my: 101, vy: 0, ...opts }), true);
  assert.equal(shouldDismiss({ my: 99, vy: 0, ...opts }), false);
});

test("shouldDismiss — closes on a fast flick that barely moved", () => {
  const opts = { height: 400, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldDismiss({ my: 20, vy: 0.9, ...opts }), true);
});

test("shouldDismiss — springs back on a slow short pull", () => {
  const opts = { height: 400, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldDismiss({ my: 20, vy: 0.1, ...opts }), false);
});

test("shouldDismiss — never dismisses on an unmeasured panel", () => {
  assert.equal(shouldDismiss({ my: 300, vy: 2, height: 0, fraction: 0.25, velocity: 0.5 }), false);
});

test("shouldDismiss — never dismisses on an upward release", () => {
  const opts = { height: 400, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldDismiss({ my: -300, vy: 0, ...opts }), false);
});

test("shouldTurnPage — commits past a quarter of width in either direction", () => {
  const W = 320;
  const opts = { width: W, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldTurnPage({ mx: -0.26 * W, vx: 0, ...opts }), true);
  assert.equal(shouldTurnPage({ mx: 0.26 * W, vx: 0, ...opts }), true);
  assert.equal(shouldTurnPage({ mx: -0.2 * W, vx: 0, ...opts }), false);
});

test("shouldTurnPage — commits on a fast flick regardless of sign", () => {
  const W = 320;
  const opts = { width: W, fraction: 0.25, velocity: 0.5 };
  assert.equal(shouldTurnPage({ mx: -12, vx: -0.9, ...opts }), true);
  assert.equal(shouldTurnPage({ mx: 12, vx: 0.9, ...opts }), true);
});

test("shouldTurnPage — never turns a page on zero width", () => {
  assert.equal(shouldTurnPage({ mx: 500, vx: 0, width: 0, fraction: 0.25, velocity: 0.5 }), false);
});
