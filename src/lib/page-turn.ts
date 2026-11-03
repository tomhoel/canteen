/**
 * Has a horizontal drag gone far enough, or fast enough, to turn the page?
 * Either past `fraction` of the width, or released faster than `velocity`
 * (px/ms) in either direction: a flick backwards is a turn the other way.
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
  /** Release speed, px/ms. Only the magnitude decides. */
  vx: number;
  width: number;
  fraction: number;
  velocity: number;
}): boolean {
  if (width <= 0) return false;
  return Math.abs(mx) > width * fraction || Math.abs(vx) > velocity;
}
