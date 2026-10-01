import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

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
  /** Reports the neighbor day to mount alongside current day during swipe. */
  onNeighborChange?: (neighbor: { day: number; position: -1 | 1 } | null) => void;
  /** Previews target day to glide day-bar pill immediately upon gesture commit. */
  onPreviewDay?: (day: number | null) => void;
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
  isSettling: () => boolean;
}

/** Below this the gesture is a tap, not a swipe. */
const MIN_SWIPE_PX = 24;
/** A release turns the page when where the finger was heading passes this share of the width (a quarter). */
const TURN_FRACTION = 0.25;
/** How far ahead of the finger, in ms, "where it was heading" looks. */
const PROJECT_MS = 200;
/** Only the last stretch of the drag counts as its speed; a pause before lifting means zero. */
const VELOCITY_WINDOW_MS = 100;
/** Past this share of the width the day-bar pill already shows the target day. */
const PREVIEW_FRACTION = 0.5;
/** The gap between two day panels, matching `--day-gap` in the CSS. */
const DAY_GAP_PX = 16;
/** How early the axis is committed. See the comment at the decision point. */
const AXIS_LOCK_PX = 4;
/** Trackpad flicks arrive in bursts; one page turn per burst. */
const WHEEL_COOLDOWN_MS = 350;

/**
 * Whether a release turns the page: where the finger was heading (position plus
 * a short run-out at its release speed) must pass a quarter of the width, in the
 * direction it is already displaced. A slow nudge never turns; a short quick
 * flick does; a flick against the displacement cancels.
 */
export function shouldTurn(offset: number, velocity: number, width: number): boolean {
  if (Math.abs(offset) < MIN_SWIPE_PX) return false;
  const projected = offset + velocity * PROJECT_MS;
  return Math.sign(projected) === Math.sign(offset) && Math.abs(projected) > width * TURN_FRACTION;
}

/** Finger speed in px/ms over the last VELOCITY_WINDOW_MS, 0 if it paused before lifting. */
export function recentVelocity(points: { x: number; t: number }[], now: number): number {
  const live = points.filter((p) => now - p.t <= VELOCITY_WINDOW_MS);
  if (live.length < 2) return 0;
  const first = live[0];
  const last = live[live.length - 1];
  return (last.x - first.x) / Math.max(1, last.t - first.t);
}

/** iOS-style rubber band: follows the finger at first, then gives up toward `width`. */
export function rubberBand(distance: number, width: number): number {
  const d = Math.abs(distance);
  return Math.sign(distance) * (1 - 1 / ((d * 0.35) / width + 1)) * width;
}

export function useDaySwipe({
  scrollRef,
  selectedDay,
  onSelectDay,
  blocked,
  ready,
  markSwipe,
  onNeighborChange,
  onPreviewDay,
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
   */
  const swipeAxis = useRef<"undecided" | "x" | "y">("undecided");

  const trackRef = useRef<HTMLDivElement | null>(null);
  /** Where the track sits, in px from centre. Zero whenever nothing is dragging or settling. */
  const offsetRef = useRef(0);
  /** Where the track was when this finger landed: zero, or wherever a settle was caught. */
  const baseRef = useRef(0);
  const recentRef = useRef<{ x: number; t: number }[]>([]);
  const limitRef = useRef(0);
  const settlingRef = useRef<"turn" | "cancel" | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewedRef = useRef<number | null>(null);

  const onNeighborChangeRef = useRef(onNeighborChange);
  useEffect(() => {
    onNeighborChangeRef.current = onNeighborChange;
  });

  const onPreviewDayRef = useRef(onPreviewDay);
  useEffect(() => {
    onPreviewDayRef.current = onPreviewDay;
  });

  const activeNeighborRef = useRef<{ day: number; position: -1 | 1 } | null>(null);

  const setPreview = useCallback((day: number | null) => {
    if (previewedRef.current === day) return;
    previewedRef.current = day;
    onPreviewDayRef.current?.(day);
  }, []);

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = undefined;
  }, []);

  /**
   * Hand the element back: no transition, and no transform at all.
   */
  const releaseTrack = useCallback(() => {
    const el = trackRef.current;
    settlingRef.current = null;
    offsetRef.current = 0;
    baseRef.current = 0;
    clearSettleTimer();
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
    el.classList.remove("is-swiping");
    activeNeighborRef.current = null;
    onNeighborChangeRef.current?.(null);
  }, [clearSettleTimer]);

  /**
   * Take the element for a drag: freeze wherever the settle had painted it.
   */
  const grabTrack = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    if (settlingRef.current) {
      offsetRef.current = new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
      settlingRef.current = null;
      clearSettleTimer();
    }
    el.style.transition = "none";
    el.classList.add("is-swiping");
  }, [clearSettleTimer]);

  const writeOffset = useCallback((px: number) => {
    offsetRef.current = px;
    const el = trackRef.current;
    if (el) {
      el.style.transform = `translate3d(${px}px, 0, 0)`;
      if (!el.classList.contains("is-swiping")) {
        el.classList.add("is-swiping");
      }
    }
  }, []);

  const dayRef = useRef(0);
  useEffect(() => {
    dayRef.current = selectedDay;
  }, [selectedDay]);

  /**
   * Glide the track to `transform` and call `done` the moment it arrives.
   *
   * The duration follows the distance left and how fast the finger was moving, so
   * a flick glides out quickly and a slow release does not snap. `transitionend`
   * is the real signal; the timer is only a backstop for when it never fires (the
   * tab hidden mid-glide, say). Reduced motion skips the glide.
   */
  const settle = useCallback(
    (kind: "turn" | "cancel", transform: string, remainingPx: number, speed: number, done: () => void) => {
      const el = trackRef.current;
      if (!el) {
        done();
        return;
      }
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const duration = reduce
        ? 0
        : Math.round(Math.min(kind === "turn" ? 320 : 240, Math.max(150, remainingPx / Math.max(Math.abs(speed), 0.8))));

      clearSettleTimer();
      settlingRef.current = kind;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        el.removeEventListener("transitionend", onEnd);
        clearSettleTimer();
        done();
      };
      const onEnd = (e: TransitionEvent) => {
        if (e.target === el && e.propertyName === "transform") finish();
      };
      el.addEventListener("transitionend", onEnd);
      settleTimer.current = setTimeout(finish, duration + 80);

      el.style.transition = duration ? `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)` : "none";
      el.style.transform = transform;
      offsetRef.current = 0;
      if (!duration) finish();
    },
    [clearSettleTimer]
  );

  /**
   * Settle a completed page turn: glide into the destination, then commit the day
   * in the same synchronous flush that clears the transform, so no frame ever shows
   * the track recentred over the old day.
   */
  const settleTurn = useCallback(
    (dir: -1 | 1, targetDay: number, from: number, speed: number) => {
      setPreview(targetDay);
      const travel = window.innerWidth + DAY_GAP_PX;
      settle(
        "turn",
        `translate3d(${dir === -1 ? "calc(-100% - 16px)" : "calc(100% + 16px)"}, 0, 0)`,
        Math.abs(travel * dir - from),
        speed,
        () => {
          // handleDaySelect refuses while a turn is settling, so this one is over first.
          settlingRef.current = null;
          flushSync(() => {
            markSwipe();
            onSelectDay(targetDay);
            previewedRef.current = null;
            onPreviewDayRef.current?.(null);
            releaseTrack();
          });
        }
      );
    },
    [markSwipe, onSelectDay, releaseTrack, setPreview, settle]
  );

  /**
   * Settle a canceled drag: return current day to center.
   */
  const settleCancel = useCallback(
    (speed = 0) => {
      const from = offsetRef.current;
      setPreview(null);
      if (from === 0 && !settlingRef.current) {
        releaseTrack();
        return;
      }
      settle("cancel", "translate3d(0px, 0, 0)", Math.abs(from), speed, releaseTrack);
    },
    [releaseTrack, setPreview, settle]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // A glide back to centre can be caught mid-flight and dragged on from where it
      // is; a glide into the next day is committed and cannot.
      if (settlingRef.current === "turn") return;
      if (e.touches.length === 1) {
        if (settlingRef.current === "cancel") grabTrack();
        baseRef.current = offsetRef.current;
        swipeAxis.current = "undecided";
        touchStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          time: performance.now(),
        };
      }
    },
    [grabTrack]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => {
      if (settlingRef.current) return;
      const start = touchStartRef.current;
      if (!start || e.touches.length !== 1) return;

      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;

      if (swipeAxis.current === "undecided") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        swipeAxis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (swipeAxis.current === "x") {
          limitRef.current = window.innerWidth * 0.95;
          recentRef.current = [];
          grabTrack();
        }
      }

      if (swipeAxis.current !== "x") return;
      if (e.cancelable) e.preventDefault();

      const width = window.innerWidth;
      const raw = baseRef.current + dx;
      const day = dayRef.current;
      const edge = (day <= 0 && raw > 0) || (day >= 4 && raw < 0);
      const limit = limitRef.current;
      const next = Math.max(-limit, Math.min(limit, edge ? rubberBand(raw, width) : raw));

      const now = performance.now();
      const pts = recentRef.current;
      pts.push({ x: e.touches[0].clientX, t: now });
      while (pts.length > 1 && now - pts[0].t > VELOCITY_WINDOW_MS) pts.shift();

      // Mount the neighbor on the side the track is displaced toward, as soon as the
      // axis locks (4px), so its render lands before any real movement is visible.
      const target = next < 0 ? day + 1 : next > 0 ? day - 1 : null;
      const hasTarget = target !== null && target >= 0 && target <= 4;
      if (hasTarget) {
        if (activeNeighborRef.current?.day !== target) {
          activeNeighborRef.current = { day: target, position: next < 0 ? 1 : -1 };
          onNeighborChangeRef.current?.(activeNeighborRef.current);
        }
      } else if (activeNeighborRef.current !== null) {
        activeNeighborRef.current = null;
        onNeighborChangeRef.current?.(null);
      }

      // The day-bar pill follows the drag: it moves once the neighbor is past halfway.
      setPreview(hasTarget && Math.abs(next) > width * PREVIEW_FRACTION ? target : null);

      writeOffset(next);
    };

    const onTouchCancel = () => {
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";
      if (axis === "x" || offsetRef.current !== 0) settleCancel();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [grabTrack, ready, scrollRef, settleCancel, setPreview, writeOffset]);

  const handleTouchEnd = useCallback(
    (_e: React.TouchEvent) => {
      if (settlingRef.current) return;
      if (!touchStartRef.current) return;
      const velocity = recentVelocity(recentRef.current, performance.now());
      const offset = offsetRef.current;
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";

      if (axis !== "x") {
        // A tap that caught a glide in flight: let it finish what it was doing.
        if (offset !== 0) settleCancel();
        return;
      }

      // Do not switch day if an overlay or modal is active
      if (blocked) {
        settleCancel();
        return;
      }

      const canGoNext = offset < 0 && dayRef.current < 4;
      const canGoPrev = offset > 0 && dayRef.current > 0;

      if ((canGoNext || canGoPrev) && shouldTurn(offset, velocity, window.innerWidth)) {
        settleTurn(canGoNext ? -1 : 1, canGoNext ? dayRef.current + 1 : dayRef.current - 1, offset, velocity);
      } else {
        settleCancel(velocity);
      }
    },
    [blocked, settleTurn, settleCancel]
  );

  const isSettling = useCallback(() => settlingRef.current === "turn", []);


  return {
    trackRef,
    handleWheel,
    handleTouchStart,
    handleTouchEnd,
    isSettling,
  };
}
