import { useCallback, useEffect, useRef } from "react";
import { shouldTurnPage } from "@/lib/sheet-drag";

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
  onNeighborChange,
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
  const offsetRef = useRef(0);
  const recentRef = useRef<{ x: number; t: number }[]>([]);
  const limitRef = useRef(0);
  const settlingRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onNeighborChangeRef = useRef(onNeighborChange);
  useEffect(() => {
    onNeighborChangeRef.current = onNeighborChange;
  });
  const activeNeighborRef = useRef<{ day: number; position: -1 | 1 } | null>(null);

  /**
   * Hand the element back: no transition, and no transform at all.
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
    el.style.removeProperty("--drag-offset");
    el.classList.remove("is-swiping");
    activeNeighborRef.current = null;
    onNeighborChangeRef.current?.(null);
  }, []);

  /**
   * Take the element for a drag: freeze wherever the settle had painted it.
   */
  const grabTrack = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    if (settlingRef.current) {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      offsetRef.current = m.m41;
      settlingRef.current = false;
      if (settleTimer.current) {
        clearTimeout(settleTimer.current);
        settleTimer.current = undefined;
      }
    }
    el.style.transition = "none";
    el.classList.add("is-swiping");
  }, []);

  const writeOffset = useCallback((px: number) => {
    offsetRef.current = px;
    const el = trackRef.current;
    if (el) {
      el.style.transform = `translate3d(${px}px, 0, 0)`;
      el.style.setProperty("--drag-offset", `${px}px`);
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
   * Settle a completed page turn: slide track to target day and commit change.
   */
  const settleTurn = useCallback(
    (dir: -1 | 1, targetDay: number) => {
      const el = trackRef.current;
      if (!el) {
        onSelectDay(targetDay);
        return;
      }

      settlingRef.current = true;
      const duration = 280;
      el.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      el.style.transform = dir === -1 ? "translate3d(-100%, 0, 0)" : "translate3d(100%, 0, 0)";
      offsetRef.current = 0;

      markSwipe();
      onSelectDay(targetDay);

      settleTimer.current = setTimeout(() => {
        releaseTrack();
      }, duration);
    },
    [markSwipe, onSelectDay, releaseTrack]
  );

  /**
   * Settle a canceled drag: return current day to center.
   */
  const settleCancel = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;

    if (offsetRef.current === 0) {
      releaseTrack();
      return;
    }

    settlingRef.current = true;
    const duration = 240;
    el.style.transition = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    el.style.transform = "translate3d(0px, 0, 0)";
    offsetRef.current = 0;

    settleTimer.current = setTimeout(() => {
      releaseTrack();
    }, duration);
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

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => {
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

      const atStart = dayRef.current <= 0 && dx > 0;
      const atEnd = dayRef.current >= 4 && dx < 0;
      const resisted = atStart || atEnd ? dx * 0.28 : dx;
      const limit = limitRef.current;
      const next = Math.max(-limit, Math.min(limit, resisted));

      const now = performance.now();
      const pts = recentRef.current;
      pts.push({ x: next, t: now });
      if (pts.length > 2) pts.shift();

      // Mount or switch the neighbor panel in the direction of the drag
      if (dx < -6 && dayRef.current < 4) {
        const target = dayRef.current + 1;
        if (!activeNeighborRef.current || activeNeighborRef.current.day !== target) {
          activeNeighborRef.current = { day: target, position: 1 };
          onNeighborChangeRef.current?.({ day: target, position: 1 });
        }
      } else if (dx > 6 && dayRef.current > 0) {
        const target = dayRef.current - 1;
        if (!activeNeighborRef.current || activeNeighborRef.current.day !== target) {
          activeNeighborRef.current = { day: target, position: -1 };
          onNeighborChangeRef.current?.({ day: target, position: -1 });
        }
      } else if (atStart || atEnd) {
        if (activeNeighborRef.current !== null) {
          activeNeighborRef.current = null;
          onNeighborChangeRef.current?.(null);
        }
      }

      writeOffset(next);
    };

    const onTouchCancel = () => {
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";
      if (axis === "x") settleCancel();
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [grabTrack, ready, scrollRef, settleCancel, writeOffset]);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const dt = Math.max(1, performance.now() - touchStartRef.current.time);
      const vx = deltaX / dt;
      const width = typeof window !== "undefined" ? window.innerWidth : 360;
      touchStartRef.current = null;
      const axis = swipeAxis.current;
      swipeAxis.current = "undecided";

      if (axis !== "x") {
        if (settlingRef.current) releaseTrack();
        return;
      }

      // Do not switch day if an overlay or modal is active
      if (blocked) {
        settleCancel();
        return;
      }

      const willTurn =
        Math.abs(deltaX) > MIN_SWIPE_PX &&
        shouldTurnPage({ mx: deltaX, vx, width, fraction: 0.08, velocity: 0.25 });

      const canGoNext = deltaX < 0 && dayRef.current < 4;
      const canGoPrev = deltaX > 0 && dayRef.current > 0;

      if (willTurn && (canGoNext || canGoPrev)) {
        const targetDay = canGoNext ? dayRef.current + 1 : dayRef.current - 1;
        settleTurn(canGoNext ? -1 : 1, targetDay);
      } else {
        settleCancel();
      }
    },
    [blocked, releaseTrack, settleTurn, settleCancel]
  );

  return {
    trackRef,
    handleWheel,
    handleTouchStart,
    handleTouchEnd,
  };
}
