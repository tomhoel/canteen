import test from "node:test";
import assert from "node:assert/strict";
import { __shellInertInternals as inert } from "./useShellInert.js";

/**
 * The refcount, tested without a DOM.
 *
 * What makes this worth pinning is that overlays in this app genuinely stack —
 * the recipe modal opens over the action sheet, and the deals and Meny views
 * open over the recipe. A plain boolean would have the inner overlay's unmount
 * clear `inert` while the outer one is still on screen, silently handing the
 * page behind it back to the tab order. That is the bug this replaced, in a
 * subtler form.
 */

test("the shell is claimed on the first overlay and released on the last", () => {
  inert.reset();
  assert.equal(inert.count(), 0);
  inert.claimShell();
  assert.equal(inert.count(), 1);
  inert.releaseShell();
  assert.equal(inert.count(), 0);
});

test("a stacked overlay does not release the shell when it closes", () => {
  // Action sheet opens, recipe modal opens over it, recipe modal closes.
  // The sheet is still open, so the shell must stay inert.
  inert.reset();
  inert.claimShell(); // sheet
  inert.claimShell(); // recipe
  inert.releaseShell(); // recipe closes
  assert.equal(inert.count(), 1, "the sheet still holds it");
  inert.releaseShell(); // sheet closes
  assert.equal(inert.count(), 0);
});

test("three deep unwinds in any order", () => {
  inert.reset();
  inert.claimShell();
  inert.claimShell();
  inert.claimShell();
  assert.equal(inert.count(), 3);
  inert.releaseShell();
  inert.releaseShell();
  assert.equal(inert.count(), 1);
  inert.releaseShell();
  assert.equal(inert.count(), 0);
});

test("an extra release cannot drive the count negative", () => {
  // A component unmounting after an ancestor already tore the tree down can
  // release twice. Unclamped, the count goes to -1 and the *next* overlay's
  // claim only reaches 0 — so the following overlay silently gets no inert.
  inert.reset();
  inert.releaseShell();
  inert.releaseShell();
  assert.equal(inert.count(), 0);

  inert.claimShell();
  assert.equal(inert.count(), 1, "the next overlay must still reach 1");
});

test("no DOM is not an error", () => {
  // The module is imported by components that could be rendered outside a
  // browser; claiming must be a no-op rather than a throw.
  inert.reset();
  assert.doesNotThrow(() => {
    inert.claimShell();
    inert.releaseShell();
  });
});
