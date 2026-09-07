import { useCallback, useEffect, useRef } from "react";
import { shouldTurnPage } from "@/lib/sheet-drag";
import { sampleSpring } from "@/lib/spring-easing";

/**
 * Everything that turns a finger or a trackpad into a day change.
 *
 * Lifted out of HomeClient as one piece because it is one piece: the axis
 * lock, the MotionValue the strip rides on, the non-passive listener and the
 * release threshold are four halves of the same gesture, and every bug in this
 * area came from changing one of them without the others. Keeping them in a
 * file of their own makes the coupling explicit instead of incidental.
 *
 * The comments below are load-bearing. Each one records a bug that shipped.
 */

export interface UseDaySwipeOptions {
  /** The scrolling element the listener attaches to. */
  scrollRef: React.RefObject<HTMLElement | null>;
  selectedDay: number;
  onSelectDay: (day: number) => void;
  /** True while an overlay owns the screen — a swipe underneath must not turn the page. */
  blocked: boolean;
  /**
   * Whether the scrolling element exists yet.
   *
   * This is the dependency the non-passive listener genuinely has, and getting
   * it wrong shipped a bug that only appeared in production: HomeClient renders
   * `<LoadingScreen />` until the menu arrives, so `scrollRef.current` is null
   * and the effect bails. With a dependency list that never changed afterwards,
   * the effect ran exactly once — on the loading render — and the listener was
   * never attached at all. Development hid it, because StrictMode re-runs
   * effects and that gave it a second chance.
   *
   * A boolean rather than the menu object on purpose: it flips false→true once,
   * so the listener is registered once. Passing the object re-registered it on
   * every background refresh, and re-registering mid-gesture drops the swipe in
   * progress.
   */
  ready: boolean;
  /**
   * Called immediately after a swipe-driven day change, to flag that this
   * change came from a finger.
   *
   * The flag lives in the component rather than here, because clearing it is
   * part of every day change — including a tap on the day bar, which never
   * reaches this hook. The component clears it inside the same state update
   * that moves the day, and this call sets it again in the same batch, so the
   * later write wins and both land in one render. AnimatePresence reads the
   * value as its `custom` during that render, so an effect one render later
   * would be too late and the first swiped day would animate as if tapped.
   */
  markSwipe: () => void;
}

export interface DaySwipe {
  /**
   * Attach to `.cards-track`. The hook writes `transform` straight onto it.
   *
   * This used to be a MotionValue the component handed to `style={{ x }}`.
   * Writing the element directly costs nothing in fidelity — the value was
   * never read by anything else (grep: `dragX` appeared only here and at the
   * one `.cards-track` call site) — and it takes motion's animation runtime
   * off the critical path, which was the point.
   */
  trackRef: React.RefObject<HTMLDivElement | null>;
  handleWheel: (e: React.WheelEvent) => void;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
}

/** Below this the gesture is a tap, not a swipe. */
const MIN_SWIPE_PX = 28;
/** How early the axis is committed. See the comment at the decision point. */
const AXIS_LOCK_PX = 4;
/** Trackpad flicks arrive in bursts; one page turn per burst. */
const WHEEL_COOLDOWN_MS = 350;

export function useDaySwipe({
  scrollRef,
  selectedDay,
  onSelectDay,
  blocked,
  ready,
  markSwipe,
}: UseDaySwipeOptions): DaySwipe {
  // Trackpad horizontal swipe detection
  const lastWheelTimeRef = useRef(0);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (Math.abs(e.deltaX) > 35 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3) {
        const now = performance.now();
        if (now - lastWheelTimeRef.current < WHEEL_COOLDOWN_MS) return;
        lastWheelTimeRef.current = now;
        if (e.deltaX > 0 && selectedDay < 4) {
          onSelectDay(selectedDay + 1);
        } else if (e.deltaX < 0 && selectedDay > 0) {
          onSelectDay(selectedDay - 1);
        }
      }
    },
    [selectedDay, onSelectDay]
  );

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  /**
   * Which way this gesture turned out to be going, decided once and then kept.
   *
   * Without it a swipe is only ever measured at its two ends, so for the whole
   * gesture in between the browser does whatever it likes — and what it likes
   * is to scroll `.cards-container`, because a sideways flick is never
   * perfectly level. That vertical drift is what drags the phone browser's
   * bottom bar back over the day strip mid-swipe.
   */
  const swipeAxis = useRef<"undecided" | "x" | "y">("undecided");

  /**
   * How far the finger has dragged the day strip, in pixels.
   *
   * The gesture used to produce nothing at all until it ended: you dragged, the
   * screen sat still, you let go, and only then did a spring play. That dead
   * interval is most of what "the swipe feels slow" means — it is latency, not
   * frame rate, and no amount of shaving animation cost touches it. The strip
   * now moves with the finger.
   *
   * It rides on `.cards-track` rather than on the day wrapper because the
   * wrapper's own `x` belongs to the enter/exit variants. Keeping them on
   * separate elements means the drag and the day change compose instead of
   * fighting over one property.
   */
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** Where the strip currently sits, in px. The old MotionValue's `.get()`. */
  const offsetRef = useRef(0);

  /**
   * The last two touchmoves, for the release velocity.
   *
   * `handleTouchEnd` already computes a `vx`, but that is the average over the
   * whole gesture and it is used for the page-turn threshold, where average is
   * what you want. The settle needs the *instantaneous* velocity at the lift —
   * what `MotionValue.getVelocity()` returned — because that is what carries
   * the strip a little further out before it turns back on a hard flick.
   */
  const recentRef = useRef<{ x: number; t: number }[]>([]);

  /** `window.innerWidth * 0.55`, sampled once per gesture at the axis lock. */
  const limitRef = useRef(0);

  /** Set while a settle transition is in flight, so a new grab can cancel it. */
  const settlingRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Hand the element back: no transition, and no transform at all.
   *
   * Cleared to `""` rather than parked on `translateX(0px)` deliberately. It is
   * what motion did — `buildTransform` collapses an all-default transform to
   * the string `none` — and a transform makes the element a containing block
   * for any absolutely positioned descendant. Nothing inside `.cards-track` is
   * absolutely positioned today (the day transition stacks the two days in the
   * track's grid cell instead), so this currently costs nothing either way;
   * it stays because the day that changes, this is a silent bug.
   */
  const releaseTrack = useCallback(() => {
    const el = trackRef.current;
    settlingRef.current = false;
    if (settleTimer.current) {
      clearTimeout(settleTimer.current);
      settleTimer.current = undefined;
    }
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
  }, []);

  /**
   * Take the element for a drag: freeze wherever the settle had painted it.
   *
   * `MotionValue.set()` did NOT stop a running animation — only `jump()` and
   * `start()` call `stop()` — so grabbing the strip mid-settle used to leave
   * the spring writing every frame while the finger wrote the absolute offset,
   * and the two fought for the rest of the settle. This freezes first.
   */
  const grabTrack = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    if (settlingRef.current) {
      // Read where the transition has actually painted it, then pin that.
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      offsetRef.current = m.m41;
      settlingRef.current = false;
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = undefined;
      }
    }
    el.style.transition = "none";
  }, []);

  const writeOffset = useCallback((px: number) => {
    offsetRef.current = px;
    const el = trackRef.current;
    if (el) el.style.transform = `translateX(${px}px)`;
  }, []);

  /**
   * The selected day, readable from the touchmove listener.
   *
   * That listener is attached once — it has to be, because re-registering a
   * non-passive listener on every day change would drop the gesture in
   * progress — so it cannot close over state.
   */
  const dayRef = useRef(0);
  useEffect(() => {
    dayRef.current = selectedDay;
  }, [selectedDay]);

  /**
   * Send the strip home on the spring it always used: 380/40/0.7.
   *
   * That spring is over-damped (damping ratio 1.226), so it has a closed form,
   * and `spring-easing.ts` solves it for this gesture's release velocity and
   * hands the result to CSS as a sampled `linear()` easing. A `cubic-bezier`
   * would have been simpler and would have thrown the velocity away — and with
   * it the thing a hard flick actually does, which is carry the strip about
   * 10px further out before turning back. That carry is most of what the
   * gesture feels like, so it is worth the thirty lines.
   *
   * The transition also runs on the compositor, which the rAF-driven spring
   * never did.
   */
  const settleDrag = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    if (offsetRef.current === 0) {
      releaseTrack();
      return;
    }

    // Under reduced motion the stylesheet's `* { transition: none !important }`
    // beats the inline transition, so nothing animates and no transitionend
    // ever fires. Release now rather than hold the element for half a second
    // per swipe waiting for an event that cannot arrive.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      releaseTrack();
      return;
    }

    // Instantaneous velocity at the lift, in px/s, from the last two moves.
    const pts = recentRef.current;
    let velocity = 0;
    if (pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const dt = b.t - a.t;
      if (dt > 0) velocity = ((b.x - a.x) / dt) * 1000;
    }

    const { durationMs, easing } = sampleSpring(
      { stiffness: 380, damping: 40, mass: 0.7 },
      offsetRef.current,
      velocity
    );
    if (!durationMs) {
      releaseTrack();
      return;
    }

    settlingRef.current = true;
    el.style.transition = `transform ${durationMs}ms ${easing}`;
    el.style.transform = "translateX(0px)";
    offsetRef.current = 0;

    // The timer is the authority, not transitionend. transitionend bubbles, and
    // the two day panels inside this element transition `transform` and
    // `opacity` on every day change — a swipe fires both by construction — so a
    // listener here would be ended by a panel's event mid-settle. A guarded
    // listener would work; a timer needs no guard and cannot be fooled.
    settleTimer.current = setTimeout(releaseTrack, durationMs + 60);
  }, [releaseTrack]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      swipeAxis.current = "undecided";
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: performance.now(),
      };
    }
  }, []);

  /**
   * Attached by hand rather than as onTouchMove, because React registers
   * touchmove as a passive listener and preventDefault is ignored on those.
   * Cancelling the horizontal case is the whole point: it stops the day swipe
   * from scrolling the page, so the browser chrome stays where it is and the
   * gesture does one thing instead of two.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start || e.touches.length !== 1) return;

      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;

      // Decide early. Chrome commits to a scroll within a few pixels, and once
      // it has, every following touchmove arrives with cancelable already
      // false — preventDefault then does nothing at all. Waiting for a
      // comfortable 10px of travel means losing the race on most swipes.
      if (swipeAxis.current === "undecided") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        swipeAxis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (swipeAxis.current === "x") {
          // Once per gesture, not once per move. Reading innerWidth flushes
          // style, and now that we also WRITE style on every move that would
          // be a thrash the old code avoided only because motion deferred its
          // write to the next frame.
          limitRef.current = window.innerWidth * 0.55;
          recentRef.current = [];
          grabTrack();
        }
      }

      // Only the horizontal case is cancelled, and only once the axis is
      // known. Cancelling every move — which an earlier version did whenever
      // the container had nothing to scroll — makes iOS block the compositor
      // on the main thread for each touchmove before it can act on the
      // gesture, which is a real cost paid on every finger movement including
      // the vertical ones we have no interest in.
      if (swipeAxis.current !== "x") return;
      if (e.cancelable) e.preventDefault();

      // Resistance at the two ends. Monday dragged rightwards and Friday
      // dragged leftwards have nowhere to go, so they follow at a quarter
      // speed — the strip still answers the finger, but it tells you there is
      // nothing there. Writing straight to a MotionValue keeps this off
      // React's render path: no state, no reconciliation, one style write per
      // frame.
      const atStart = dayRef.current <= 0 && dx > 0;
      const atEnd = dayRef.current >= 4 && dx < 0;
      const resisted = atStart || atEnd ? dx * 0.25 : dx;
      const limit = limitRef.current;
      const next = Math.max(-limit, Math.min(limit, resisted));

      // Kept for the release velocity; two points is all the settle needs.
      const now = performance.now();
      const pts = recentRef.current;
      pts.push({ x: next, t: now });
      if (pts.length > 2) pts.shift();

      writeOffset(next);
    };

    // A system gesture — the app switcher, a notification shade, an incoming
    // call — takes the touch away without ever firing touchend. There was no
    // handler for that, so the strip simply stayed where the finger left it
    // until the next gesture. Now it would also strand `transition: none` on
    // the element, so this is required rather than a nicety.
    const onTouchCancel = () => {
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";
      if (axis === "x") settleDrag();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
    // `ready` is here because the element this attaches to does not exist until
    // the menu arrives — see the field's own comment. Neither dependency
    // changes on a day switch, which is what matters.
    // `grabTrack` and `writeOffset` both have empty dependency arrays, so they
    // are referentially stable and this still attaches exactly once. That
    // property is load-bearing — re-registering a non-passive listener drops
    // the gesture in progress — so if either ever grows a dependency, this
    // effect has to stop depending on it.
  }, [grabTrack, ready, scrollRef, settleDrag, writeOffset]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;
      const dt = Math.max(1, performance.now() - touchStartRef.current.time);
      const vx = deltaX / dt;
      const width = typeof window !== "undefined" ? window.innerWidth : 360;
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";
      // Whether or not this becomes a day change, the strip returns to rest. If
      // it does, the incoming day's own spring plays on top of this one and the
      // two read as a single movement; if it does not, this is the snap-back
      // that tells you the swipe was not enough.
      if (axis === "x") settleDrag();

      // Do not switch day if an overlay or modal is active
      if (blocked) return;

      // Must be horizontally dominant to avoid triggering on vertical scroll.
      // The axis lock has usually already decided this; the check stays for the
      // gesture too short to have tripped it.
      if (axis !== "y" && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > MIN_SWIPE_PX) {
        if (shouldTurnPage({ mx: deltaX, vx, width, fraction: 0.08, velocity: 0.25 })) {
          if (deltaX < 0 && selectedDay < 4) {
            onSelectDay(selectedDay + 1);
            markSwipe();
          } else if (deltaX > 0 && selectedDay > 0) {
            onSelectDay(selectedDay - 1);
            markSwipe();
          }
        }
      }
    },
    [selectedDay, onSelectDay, blocked, settleDrag, markSwipe]
  );

  return {
    trackRef,
    handleWheel,
    handleTouchStart,
    handleTouchEnd,
  };
}
