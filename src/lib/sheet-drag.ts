/**
 * Gesture decisions behind drag-to-dismiss and swipe navigation.
 * Ported from sister project mutu-web for 120Hz native gesture responsiveness.
 */

export type DragState = {
  /** Was every scrollable between the finger and the panel at `scrollTop: 0` when the press began? */
  atTop: boolean;
  /** Has this gesture already been claimed as a dismiss? */
  engaged: boolean;
  /** Vertical movement so far, in px. Positive is downward. */
  my: number;
};

/**
 * Should this movement be taken over as a sheet dismiss?
 * Once engaged it STAYS engaged so the panel does not glitch mid-gesture.
 */
export function shouldEngage({ atTop, engaged, my }: DragState): boolean {
  if (engaged) return true;
  // The body still has somewhere to scroll — this is a scroll, not a dismiss.
  if (!atTop) return false;
  // Not yet proven downward. Ask again on the next move.
  if (my <= 0) return false;
  return true;
}

/**
 * On release: does the sheet close, or spring back?
 * Distance OR velocity, so a short fast flick closes just as reliably as a slow long drag.
 */
export function shouldDismiss({
  my,
  vy,
  dy,
  height,
  fraction,
  velocity,
}: {
  my: number;
  vy: number;
  /**
   * Sign of the last movement: 1 down, -1 up, 0 still.
   *
   * This has to be passed separately because `vy` is NOT signed. `@use-gesture`
   * computes velocity from `_absoluteDelta = state._delta.map(Math.abs)`, so it
   * is a magnitude and a hard flick reads the same upward as downward. Without
   * the sign, the universal "no, put it back" upward flick cleared the velocity
   * threshold and dismissed the sheet.
   */
  dy: number;
  height: number;
  fraction: number;
  velocity: number;
}): boolean {
  if (height <= 0) return false;
  // A deliberate upward flick is a cancel, however far down the panel already is.
  if (dy < 0 && vy > velocity) return false;
  return my > height * fraction || (dy > 0 && vy > velocity);
}

/**
 * The same decision on a horizontal rail: has this drag gone far enough, or fast enough, to turn
 * the page?
 */
export function shouldTurnPage({
  mx,
  vx,
  width,
  fraction,
  velocity,
}: {
  /** Horizontal movement so far, in px. Sign is direction; only the magnitude decides. */
  mx: number;
  vx: number;
  width: number;
  fraction: number;
  velocity: number;
}): boolean {
  return shouldDismiss({
    my: Math.abs(mx),
    vy: Math.abs(vx),
    // Page-turning is bidirectional — both terms are already absolute, and a
    // flick "backwards" is a page turn the other way, not a cancel. Pinning the
    // sign to 1 keeps the direction guard out of it, so this behaves exactly as
    // it did before that guard existed.
    dy: 1,
    height: width,
    fraction,
    velocity,
  });
}
