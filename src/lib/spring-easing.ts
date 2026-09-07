/**
 * A spring, expressed as something CSS can run on the compositor.
 *
 * Replacing motion's `animate(value, 0, { type: "spring", ... })` with a
 * `cubic-bezier` loses one thing that matters here: the release velocity. The
 * day strip's settle is started from `dragX.getVelocity()`, so a hard flick
 * currently carries the strip a little *further* in the drag direction before
 * it turns back — from -100px at -1500px/s it peaks at -110.2px about 16ms
 * after the finger leaves. A cubic-bezier always starts from rest, so that
 * carry simply disappears, and the swipe is the one interaction in this app
 * that has been complained about and re-tuned more than any other.
 *
 * `linear()` does not have that limitation: it is an arbitrary sampled curve,
 * and progress values below 0 are exactly how the carry is expressed. So the
 * spring is solved per gesture, sampled, and handed to the compositor — which
 * then runs it off the main thread, which the rAF-driven spring never did.
 *
 * Every spring in this app is over-damped or critically damped, so there is a
 * closed form and no integration loop is needed:
 *
 *     x(t) = e^(-zeta*w0*t) * (A*cosh(wd*t) + B*sinh(wd*t))
 *
 * with wd = w0*sqrt(zeta^2 - 1), A = x0, B = (v0 + zeta*w0*x0)/wd.
 */

export interface SpringSpec {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface SampledSpring {
  durationMs: number;
  /** A CSS `linear(...)` easing, or a cubic-bezier fallback where unsupported. */
  easing: string;
}

/** Cached so a swipe does not re-test the same string every release. */
let linearSupported: boolean | null = null;

function supportsLinearEasing(): boolean {
  if (linearSupported !== null) return linearSupported;
  linearSupported =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("transition-timing-function", "linear(0, 1)");
  return linearSupported;
}

/**
 * The maths, with no opinion about CSS.
 *
 * Kept separate from `sampleSpring` so it is testable under `node --test`,
 * where there is no `CSS.supports` to feature-detect with — and because the
 * solution to the spring is the part worth asserting on.
 *
 * `velocity` is in px/s and points the way the finger was moving, matching
 * what `MotionValue.getVelocity()` returns. Progress runs 0 -> 1 as
 * displacement runs `from` -> 0; values outside [0, 1] are legal and are how
 * the overshoot survives the round trip.
 */
export function springPoints(
  spec: SpringSpec,
  from: number,
  velocity: number,
  { steps = 24, restPx = 0.1, maxMs = 1200 }: { steps?: number; restPx?: number; maxMs?: number } = {}
): { durationMs: number; points: number[] } {
  const { stiffness, damping, mass } = spec;
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  // A settle from nowhere has nothing to animate; and an under-damped spring
  // would need the oscillating form, which nothing in this app uses.
  if (from === 0 || zeta <= 1) return { durationMs: 0, points: [] };

  const wd = w0 * Math.sqrt(zeta * zeta - 1);
  const A = from;
  const B = (velocity + zeta * w0 * from) / wd;
  const displacement = (t: number) =>
    Math.exp(-zeta * w0 * t) * (A * Math.cosh(wd * t) + B * Math.sinh(wd * t));

  // Settle time: the first moment the spring is inside restPx. Sampled at
  // 240Hz so a fast spring is not stepped over. The scan starts past the
  // opening frames because a flick *begins* inside restPx of nothing — it
  // starts at `from` — but a spring released almost home would otherwise
  // report a zero-length settle, so the guard below covers that case.
  let durationS = maxMs / 1000;
  for (let t = 1 / 240; t < maxMs / 1000; t += 1 / 240) {
    if (Math.abs(displacement(t)) < restPx) {
      durationS = t;
      break;
    }
  }
  if (durationS <= 0) return { durationMs: 0, points: [] };

  const points: number[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(1 - displacement((i / steps) * durationS) / from);
  }
  // Pin the ends so the element lands exactly on its target rather than on a
  // rounded sample.
  points[0] = 0;
  points[points.length - 1] = 1;

  return { durationMs: Math.round(durationS * 1000), points };
}

/**
 * Solves `spec` and formats the result as a CSS easing.
 */
export function sampleSpring(
  spec: SpringSpec,
  from: number,
  velocity: number,
  opts?: { steps?: number; restPx?: number; maxMs?: number }
): SampledSpring {
  const { durationMs, points } = springPoints(spec, from, velocity, opts);
  if (!durationMs || points.length === 0) {
    return { durationMs: 0, easing: "linear" };
  }

  if (!supportsLinearEasing()) {
    // Chrome 113 / Safari 17.2 / Firefox 112 all have linear(); this is for
    // anything older. The carry is lost, which is precisely what this module
    // exists to keep — but a slightly different settle beats none at all.
    return { durationMs, easing: "cubic-bezier(0.21, 0.31, 0.06, 1)" };
  }

  return {
    durationMs,
    easing: `linear(${points.map((p) => p.toFixed(4)).join(", ")})`,
  };
}
