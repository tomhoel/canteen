import { useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { emitDayProgress } from "@/lib/day-progress";

/**
 * Every way of changing the day, as one physical movement.
 *
 * The track (`.cards-track`) holds the day on screen and, while a change is in
 * progress, the day it is changing to, mounted one width plus a gap to the side.
 * A finger drags the track 1:1; a tap on the dock, an arrow key or a trackpad
 * swipe glides the very same track the same way. When the glide arrives the day
 * is committed in the same synchronous flush that clears the transform, so no
 * frame ever shows the track recentred over the old day, and the arriving panel
 * keeps its DOM node (panels are keyed by day), so its plates never reload.
 *
 * What it keeps from the swipe it replaces, because each one fixed a bug that
 * shipped: the axis lock at 4px, the non-passive touchmove (and `touch-action:
 * pan-y` in the CSS) so a sideways drag is never taken as a scroll, the velocity
 * projection that decides a release, the rubber band past Monday and Friday, and
 * a glide back to centre that can be caught mid-flight.
 *
 * What changed: a turn in progress is no longer a lock. A new touch, tap or
 * key finishes it at once and starts the next one, so days can be flicked
 * through as fast as a thumb can move. Taps and keys no longer run a separate
 * enter/exit animation. A trackpad drags the board instead of jumping a day per
 * burst. The day dock's highlight follows the drag continuously.
 */

export interface UseDaySwipeOptions {
  /** The scrolling element the gesture listeners attach to. */
  scrollRef: React.RefObject<HTMLElement | null>;
  selectedDay: number;
  /** Commits a day change. Called inside flushSync at the end of a glide. */
  onSelectDay: (day: number) => void;
  /** True while an overlay owns the screen; a gesture underneath must not turn the page. */
  blocked: boolean;
  /**
   * Whether the scrolling element exists yet. The listeners are attached once
   * this flips true: HomeClient renders the loading shell until the menu
   * arrives, and an effect that ran only on that render never attached at all.
   */
  ready: boolean;
  /** The day to mount beside the current one, or null when nothing is moving. */
  onNeighborChange: (neighbor: { day: number; position: -1 | 1 } | null) => void;
  /** The day the dock should show as selected before the change is committed. */
  onPreviewDay: (day: number | null) => void;
}

export interface DaySwipe {
  /** Attach to `.cards-track`. The hook writes `transform` straight onto it. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  handleTouchStart: (e: React.TouchEvent) => void;
  handleTouchEnd: (e: React.TouchEvent) => void;
  /** Glide to any day: the dock, the keyboard and the URL all come through here. */
  goToDay: (day: number) => void;
}

/** Below this the gesture is a tap, not a swipe. */
const MIN_SWIPE_PX = 16;
/** A release turns the page when where the finger was heading passes this share of the width. */
const TURN_FRACTION = 0.15;
/** How far ahead of the finger, in ms, "where it was heading" looks. */
const PROJECT_MS = 260;
/** Only the last stretch of the drag counts as its speed; a pause before lifting means zero. */
const VELOCITY_WINDOW_MS = 100;
/** The gap between two day panels, matching `--day-gap` in the CSS. */
export const DAY_GAP_PX = 16;
/** How early the axis is committed. */
const AXIS_LOCK_PX = 4;
/** Trackpad: a drag that has gone this far turns the page without waiting for the release. */
const WHEEL_TURN_FRACTION = 0.22;
/** Trackpad: no wheel event for this long means the fingers have lifted. */
const WHEEL_IDLE_MS = 90;
/** Trackpad: after a turn, the momentum tail is ignored until the wheel goes quiet this long. */
const WHEEL_TAIL_MS = 180;

/** Glide timings (ms). A turn follows the remaining distance and the release speed. */
export const TURN_MIN_MS = 160;
export const TURN_MAX_MS = 300;
export const CANCEL_MAX_MS = 220;
export const GLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Whether a release turns the page: where the finger was heading (position plus
 * a short run-out at its release speed) must pass 15% of the width, in the
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

/**
 * How long a glide takes. A fast release covers the rest quickly; a slow one
 * still never drags on, and a short hop never snaps.
 */
export function glideDuration(kind: "turn" | "cancel", remainingPx: number, speed: number): number {
  const max = kind === "turn" ? TURN_MAX_MS : CANCEL_MAX_MS;
  const min = kind === "turn" ? TURN_MIN_MS : 120;
  return Math.round(Math.min(max, Math.max(min, remainingPx / Math.max(Math.abs(speed), 1.1))));
}

/**
 * Where a day change stands, as the dock reads it: the day it started from and
 * how far toward its neighbour it has got (negative toward Monday).
 */
export function dragProgress(offset: number, travel: number): number {
  if (travel <= 0) return 0;
  return Math.max(-1, Math.min(1, -offset / travel));
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useDaySwipe({
  scrollRef,
  selectedDay,
  onSelectDay,
  blocked,
  ready,
  onNeighborChange,
  onPreviewDay,
}: UseDaySwipeOptions): DaySwipe {
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Everything the listeners read lives in refs, so they are registered once
  // and a re-render mid-gesture can never drop the gesture in progress.
  const dayRef = useRef(selectedDay);
  const blockedRef = useRef(blocked);
  const onSelectDayRef = useRef(onSelectDay);
  const onNeighborRef = useRef(onNeighborChange);
  const onPreviewRef = useRef(onPreviewDay);
  useEffect(() => {
    dayRef.current = selectedDay;
    blockedRef.current = blocked;
    onSelectDayRef.current = onSelectDay;
    onNeighborRef.current = onNeighborChange;
    onPreviewRef.current = onPreviewDay;
  });

  /** Where the track sits, in px from centre. Zero whenever nothing is moving. */
  const offsetRef = useRef(0);
  /** Where the track was when this gesture began: zero, or wherever a glide back was caught. */
  const baseRef = useRef(0);
  const neighborRef = useRef<{ day: number; position: -1 | 1 } | null>(null);
  const previewRef = useRef<number | null>(null);
  /** The glide in flight, and how to finish it at once. */
  const glideRef = useRef<{ kind: "turn" | "cancel"; finish: () => void } | null>(null);

  const travel = () => (trackRef.current?.clientWidth || window.innerWidth) + DAY_GAP_PX;

  const setNeighbor = useCallback((n: { day: number; position: -1 | 1 } | null) => {
    const cur = neighborRef.current;
    if (cur?.day === n?.day && cur?.position === n?.position) return;
    neighborRef.current = n;
    onNeighborRef.current(n);
  }, []);

  const setPreview = useCallback((day: number | null) => {
    if (previewRef.current === day) return;
    previewRef.current = day;
    onPreviewRef.current(day);
  }, []);

  /** Paint the track at `px` with no transition, and tell the dock where the drag stands. */
  const writeOffset = useCallback((px: number) => {
    offsetRef.current = px;
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = px ? `translate3d(${px}px, 0, 0)` : "";
    el.classList.toggle("is-swiping", px !== 0 || neighborRef.current !== null);
    emitDayProgress(px ? { from: dayRef.current, progress: dragProgress(px, travel()) } : null);
  }, []);

  /** Hand the element back: no transition, no transform, no neighbour. */
  const releaseTrack = useCallback(() => {
    glideRef.current = null;
    offsetRef.current = 0;
    baseRef.current = 0;
    const el = trackRef.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
      el.classList.remove("is-swiping");
    }
    emitDayProgress(null);
    setNeighbor(null);
  }, [setNeighbor]);

  /**
   * Glide the track to `to` px and run `done` the moment it arrives.
   * `transitionend` is the signal; the timer is the backstop for a hidden tab.
   */
  const glide = useCallback(
    (kind: "turn" | "cancel", to: number, toDay: number, speed: number, done: () => void) => {
      const el = trackRef.current;
      const from = offsetRef.current;
      const duration = prefersReducedMotion() ? 0 : glideDuration(kind, Math.abs(to - from), speed);
      let finished = false;
      const backstop: { id?: ReturnType<typeof setTimeout> } = {};
      const onEnd = (e: TransitionEvent) => {
        if (e.target === el && e.propertyName === "transform") finish();
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(backstop.id);
        el?.removeEventListener("transitionend", onEnd);
        glideRef.current = null;
        done();
      };
      glideRef.current = { kind, finish };
      // The dock's highlight glides to the same day, over the same time.
      emitDayProgress({ settle: toDay, ms: from === to ? 0 : duration });
      if (!el || !duration || from === to) {
        finish();
        return;
      }
      el.addEventListener("transitionend", onEnd);
      backstop.id = setTimeout(finish, duration + 80);
      el.classList.add("is-swiping");
      // Resolve the start position first, so a glide that begins in the same
      // task the neighbour was mounted still has somewhere to start from.
      void el.offsetWidth;
      el.style.transition = `transform ${duration}ms ${GLIDE_EASE}`;
      el.style.transform = `translate3d(${to}px, 0, 0)`;
      offsetRef.current = to;
    },
    []
  );

  /** Turn to `target`, which must already be mounted as the neighbour. */
  const turn = useCallback(
    (target: number, speed: number) => {
      const dir = target > dayRef.current ? 1 : -1;
      setPreview(target);
      glide("turn", -dir * travel(), target, speed, () => {
        flushSync(() => {
          onSelectDayRef.current(target);
          dayRef.current = target;
          setPreview(null);
          releaseTrack();
        });
      });
    },
    [glide, releaseTrack, setPreview]
  );

  const cancel = useCallback(
    (speed = 0) => {
      setPreview(null);
      if (offsetRef.current === 0) {
        releaseTrack();
        return;
      }
      glide("cancel", 0, dayRef.current, speed, releaseTrack);
    },
    [glide, releaseTrack, setPreview]
  );

  /** Finish a turn in flight at once, so the next gesture starts from the day it was heading to. */
  const settleNow = useCallback(() => {
    const g = glideRef.current;
    if (!g) return;
    if (g.kind === "turn") {
      g.finish();
    } else {
      // A glide back is caught where it is and dragged on from there.
      const el = trackRef.current;
      const at = el ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 : 0;
      glideRef.current = null;
      writeOffset(at);
    }
  }, [writeOffset]);

  /** Mount `day` on the side `offset` points away from, or clear it at the ends of the week. */
  const neighborFor = useCallback(
    (offset: number): number | null => {
      const day = dayRef.current;
      const target = offset < 0 ? day + 1 : offset > 0 ? day - 1 : null;
      if (target === null || target < 0 || target > 4) {
        setNeighbor(null);
        return null;
      }
      setNeighbor({ day: target, position: offset < 0 ? 1 : -1 });
      return target;
    },
    [setNeighbor]
  );

  const goToDay = useCallback(
    (day: number) => {
      settleNow();
      const from = dayRef.current;
      if (day === from || day < 0 || day > 4) return;
      if (prefersReducedMotion() || !trackRef.current) {
        // No travel: the arriving panel fades in on its own (see .day-panel in the CSS).
        releaseTrack();
        onSelectDayRef.current(day);
        dayRef.current = day;
        return;
      }
      // Mount the target beside today's panel synchronously, then glide to it:
      // the same movement a finger makes, whichever way the day was picked.
      flushSync(() => setNeighbor({ day, position: day > from ? 1 : -1 }));
      writeOffset(0);
      turn(day, 0);
    },
    [releaseTrack, setNeighbor, settleNow, turn, writeOffset]
  );

  // ── Touch ──

  const touchRef = useRef<{ x: number; y: number } | null>(null);
  const axisRef = useRef<"undecided" | "x" | "y">("undecided");
  const pointsRef = useRef<{ x: number; t: number }[]>([]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return;
      settleNow();
      baseRef.current = offsetRef.current;
      axisRef.current = "undecided";
      pointsRef.current = [];
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    [settleNow]
  );

  const handleTouchEnd = useCallback(
    (_e: React.TouchEvent) => {
      const start = touchRef.current;
      touchRef.current = null;
      const axis = axisRef.current;
      axisRef.current = "undecided";
      if (!start) return;
      const offset = offsetRef.current;
      if (axis !== "x" || blockedRef.current) {
        if (offset !== 0) cancel();
        return;
      }
      const velocity = recentVelocity(pointsRef.current, performance.now());
      const target = neighborRef.current?.day;
      if (target !== undefined && shouldTurn(offset, velocity, window.innerWidth)) {
        turn(target, velocity);
      } else {
        cancel(velocity);
      }
    },
    [cancel, turn]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onTouchMove = (e: TouchEvent) => {
      const start = touchRef.current;
      if (!start || e.touches.length !== 1 || glideRef.current) return;
      const dx = e.touches[0].clientX - start.x;
      const dy = e.touches[0].clientY - start.y;

      if (axisRef.current === "undecided") {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        axisRef.current = Math.abs(dx) >= Math.abs(dy) && !blockedRef.current ? "x" : "y";
      }
      if (axisRef.current !== "x") return;
      if (e.cancelable) e.preventDefault();

      const width = window.innerWidth;
      const raw = baseRef.current + dx;
      // Past Monday and Friday there is no neighbour, and the board resists.
      const next = neighborFor(raw) === null ? rubberBand(raw, width) : raw;

      const now = performance.now();
      const pts = pointsRef.current;
      pts.push({ x: e.touches[0].clientX, t: now });
      while (pts.length > 1 && now - pts[0].t > VELOCITY_WINDOW_MS) pts.shift();

      writeOffset(next);
    };

    const onTouchCancel = () => {
      touchRef.current = null;
      axisRef.current = "undecided";
      if (offsetRef.current !== 0) cancel();
    };

    // ── Trackpad: two-finger horizontal swipes drag the board too ──
    let wheelIdle: ReturnType<typeof setTimeout> | undefined;
    let tailUntil = 0;
    let wheelSpeed = 0;
    let lastWheelAt = 0;

    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || blockedRef.current) return;
      // Keep the browser's own back/forward swipe out of it.
      if (e.cancelable) e.preventDefault();
      const now = performance.now();
      // The momentum tail of a swipe that already turned the page is not a new swipe.
      if (now < tailUntil) {
        tailUntil = now + WHEEL_TAIL_MS;
        return;
      }
      if (glideRef.current?.kind === "turn") return;
      if (glideRef.current) settleNow();

      const px = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      const raw = offsetRef.current - px;
      const width = trackRef.current?.clientWidth || window.innerWidth;
      const target = neighborFor(raw);
      const next = target === null ? Math.sign(raw) * Math.min(Math.abs(raw), width * 0.12) : raw;
      const dt = Math.max(1, now - lastWheelAt);
      wheelSpeed = lastWheelAt && dt < 60 ? -px / dt : 0;
      lastWheelAt = now;
      writeOffset(next);

      clearTimeout(wheelIdle);
      if (target !== null && Math.abs(next) > width * WHEEL_TURN_FRACTION) {
        tailUntil = now + WHEEL_TAIL_MS;
        turn(target, wheelSpeed);
        return;
      }
      wheelIdle = setTimeout(() => {
        lastWheelAt = 0;
        if (neighborRef.current && shouldTurn(offsetRef.current, wheelSpeed, width)) {
          tailUntil = performance.now() + WHEEL_TAIL_MS;
          turn(neighborRef.current.day, wheelSpeed);
        } else {
          cancel();
        }
      }, WHEEL_IDLE_MS);
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchcancel", onTouchCancel);
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(wheelIdle);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("wheel", onWheel);
    };
  }, [cancel, neighborFor, ready, scrollRef, settleNow, turn, writeOffset]);

  return { trackRef, handleTouchStart, handleTouchEnd, goToDay };
}
