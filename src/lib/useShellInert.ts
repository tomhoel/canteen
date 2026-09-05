import { useEffect } from "react";

/**
 * Marks the app shell `inert` while an overlay is open, so the page behind a
 * modal cannot be reached with Tab or by a screen reader.
 *
 * This existed only inside `ui/sheet.tsx`, so exactly one of the app's overlays
 * had it. Measured on production with three others open — the info panel, the
 * leaderboard and the week overview — the shell kept **8 reachable buttons and
 * links** behind each. Body scroll was locked in all of them, which is what
 * makes the gap easy to miss: with the mouse everything behaves, and only a
 * keyboard or a screen reader falls through the overlay into the page under it.
 *
 * Refcounted rather than a boolean, because overlays genuinely stack here: the
 * recipe modal opens over the action sheet, and the deals and Meny views open
 * over the recipe. A plain set/remove would have the inner one's unmount clear
 * the attribute while the outer one is still open.
 *
 * Module-level state is correct for this. There is one shell and one document,
 * so the count has to be shared by every caller; per-component state would let
 * two overlays each believe they were the only one.
 */
const SHELL_SELECTOR = ".app-wrapper";

let inertCount = 0;

/**
 * The shell element, or null when there is no DOM.
 *
 * The guard is what lets the refcount be tested under node:test without a DOM;
 * it is also the honest answer for any non-browser render.
 */
function shell(): Element | null {
  if (typeof document === "undefined") return null;
  return document.querySelector(SHELL_SELECTOR);
}

function claimShell() {
  inertCount++;
  if (inertCount === 1) {
    shell()?.setAttribute("inert", "");
  }
}

function releaseShell() {
  // Clamped at zero so a double release — a component unmounting after an
  // ancestor already tore the tree down — cannot drive the count negative and
  // leave the next overlay unable to reach 1.
  inertCount = Math.max(0, inertCount - 1);
  if (inertCount === 0) {
    shell()?.removeAttribute("inert");
  }
}

/** Exported for tests; not part of the component API. */
export const __shellInertInternals = {
  claimShell,
  releaseShell,
  count: () => inertCount,
  reset: () => {
    inertCount = 0;
    shell()?.removeAttribute("inert");
  },
};

/**
 * Hold the shell inert for as long as `active` is true and this component is
 * mounted.
 *
 * Safe to call unconditionally with a constant `true` from a component that is
 * itself rendered conditionally — mount claims, unmount releases.
 */
export function useShellInert(active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    claimShell();
    return releaseShell;
  }, [active]);
}
