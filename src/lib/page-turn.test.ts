import test from "node:test";
import assert from "node:assert/strict";
import { shouldTurnPage } from "./page-turn";

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
