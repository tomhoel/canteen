import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { emitDayProgress } from "@/lib/day-progress";

/**
 * The day board: `.cards-track` is a native horizontal scroller, snapping one
 * day per page, and `.cards-board` inside it holds the five days side by side.
 *
 * Two movements, each given to whatever runs it best:
 *
 * - A finger is the browser's. It scrolls the board natively, on the
 *   compositor at the screen's refresh rate, with the platform's own momentum,
 *   edge bounce and axis lock. A drag driven from touchmove listeners runs at
 *   the rate JavaScript is handed events (60 Hz on an iPhone, and only while
 *   nothing else is running) and could never match it.
 * - A tap on the dock, an arrow key or a trackpad swipe is ours. The browser's
 *   smooth scroll was measured at 880 ms for one desktop day, almost still for
 *   its first 150 ms, and a key pressed during it was lost. Instead the board
 *   glides by a CSS transform (compositor again, fast start, ~280 ms), the day
 *   is committed the moment it sets off so the next press counts from there,
 *   and a glide already under way re-aims from wherever it is. When it lands
 *   the transform is swapped for the real scroll position in the same frame.
 *
 * JavaScript otherwise only watches the scroll position: it moves the dock's
 * highlight with a finger, and commits the day once a native scroll settles.
 */

/** Without `scrollend` (older Safari), a scroll that has been quiet this long has stopped. */
const IDLE_MS = 120;
/** Trackpad: this much sideways travel in one swipe turns the page. */
const WHEEL_TURN_PX = 50;
/** Trackpad: no wheel event for this long means the fingers (and their momentum) are done. */
const WHEEL_QUIET_MS = 160;
/** The glide: fast off the mark, long soft landing. */
const GLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Mouse and trackpad boards do not scroll sideways by themselves (CSS gives
 * them `overflow-x: hidden`; keep this query in step with it). A desktop page
 * is the whole window wide and native snapping only moves on past halfway, so
 * a short trackpad swipe turns the page instead.
 */
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

export interface UseDayScrollerOptions {
  selectedDay: number;
  /** Commits a day: when a glide sets off, or once a native scroll settles. */
  onSelectDay: (day: number) => void;
  /** The day a finger has the board nearest to, or null at rest. */
  onPreviewDay: (day: number | null) => void;
  /** Whether the scroller is mounted yet (the loading shell renders without it). */
  ready: boolean;
}

/** The scroller's position in days: 0 on Monday, 1.5 halfway to Wednesday. */
export function dayPosition(scrollLeft: number, stride: number, days = 5): number {
  if (stride <= 0) return 0;
  return Math.max(0, Math.min(days - 1, scrollLeft / stride));
}

/** How long a glide over `days` days takes: a hop is quick, a jump across the week a little longer. */
export function glideMs(days: number): number {
  return Math.round(Math.min(420, 260 + 40 * Math.max(0, Math.abs(days) - 1)));
}

const boardOf = (el: HTMLElement) => el.firstElementChild as HTMLElement | null;

function stride(el: HTMLElement): number {
  const days = boardOf(el)?.children;
  const a = days?.[0] as HTMLElement | undefined;
  const b = days?.[1] as HTMLElement | undefined;
  return a && b ? b.offsetLeft - a.offsetLeft : el.clientWidth;
}

function leftOf(el: HTMLElement, day: number): number {
  return (boardOf(el)?.children[day] as HTMLElement | undefined)?.offsetLeft ?? 0;
}

export function useDayScroller({ selectedDay, onSelectDay, onPreviewDay, ready }: UseDayScrollerOptions) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /** The committed day, as the listeners see it. */
  const dayRef = useRef(selectedDay);
  const onSelectRef = useRef(onSelectDay);
  const onPreviewRef = useRef(onPreviewDay);
  useEffect(() => {
    onSelectRef.current = onSelectDay;
    onPreviewRef.current = onPreviewDay;
  });
  const previewRef = useRef<number | null>(null);
  /** The glide in flight: how to land it at once, or drop it for a new one. */
  const glideRef = useRef<{ land: () => void; drop: () => void } | null>(null);

  const setPreview = useCallback((day: number | null) => {
    if (previewRef.current === day) return;
    previewRef.current = day;
    onPreviewRef.current(day);
  }, []);

  const commit = useCallback((day: number) => {
    if (day === dayRef.current) return;
    dayRef.current = day;
    onSelectRef.current(day);
  }, []);

  /** Glide the board to `day` (see the header). Re-aims a glide already in flight. */
  const glideTo = useCallback(
    (day: number) => {
      const el = scrollerRef.current;
      const board = el && boardOf(el);
      if (!el || !board || day < 0 || day > 4) return;
      const target = leftOf(el, day);
      const base = el.scrollLeft;
      // Where the board is on screen right now, mid-glide or not.
      const shown = base - new DOMMatrixReadOnly(getComputedStyle(board).transform).m41;
      // A glide already under way is dropped where it is; this one starts from there.
      glideRef.current?.drop();

      const timer: { id?: ReturnType<typeof setTimeout> } = {};
      const drop = () => {
        clearTimeout(timer.id);
        board.removeEventListener("transitionend", onEnd);
        glideRef.current = null;
      };
      const land = () => {
        drop();
        // Same task, so the same frame: the transform goes, the real scroll position takes over.
        board.style.transition = "";
        board.style.transform = "";
        el.scrollLeft = target;
        el.classList.remove("is-gliding");
      };
      const onEnd = (e: TransitionEvent) => {
        if (e.target === board && e.propertyName === "transform") land();
      };

      emitDayProgress(null); // the dock's highlight animates on its own to the committed day
      setPreview(null);
      commit(day);

      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || Math.abs(target - shown) < 1) {
        land();
        return;
      }
      const ms = glideMs((target - shown) / stride(el));
      glideRef.current = { land, drop };
      // See `.is-gliding` in the CSS: no snapping, and room so the scroll
      // position is not clamped while the board is moved by transform.
      el.classList.add("is-gliding");
      board.style.transition = "none";
      board.style.transform = `translate3d(${base - shown}px, 0, 0)`;
      void board.offsetWidth;
      board.style.transition = `transform ${ms}ms ${GLIDE_EASE}`;
      board.style.transform = `translate3d(${base - target}px, 0, 0)`;
      board.addEventListener("transitionend", onEnd);
      // transitionend is the signal; this is the backstop for a hidden tab.
      timer.id = setTimeout(land, ms + 80);
    },
    [commit, setPreview]
  );

  // A day chosen from outside the board (first paint, `?day=`, back/forward)
  // puts the board there at once, before paint. A day the board itself
  // committed is already where the board is (or gliding there), so this does
  // nothing then.
  useLayoutEffect(() => {
    dayRef.current = selectedDay;
    const el = scrollerRef.current;
    if (!el || glideRef.current) return;
    if (Math.abs(dayPosition(el.scrollLeft, stride(el)) - selectedDay) > 0.5) {
      el.scrollLeft = leftOf(el, selectedDay);
    }
  }, [selectedDay, ready]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let idle: ReturnType<typeof setTimeout> | undefined;

    const settle = () => {
      clearTimeout(idle);
      if (glideRef.current) return;
      setPreview(null);
      commit(Math.round(dayPosition(el.scrollLeft, stride(el))));
    };

    const onScroll = () => {
      if (glideRef.current) return;
      const pos = dayPosition(el.scrollLeft, stride(el));
      const from = Math.floor(pos);
      emitDayProgress({ from, progress: pos - from });
      const near = Math.round(pos);
      setPreview(near === dayRef.current ? null : near);
      clearTimeout(idle);
      idle = setTimeout(settle, IDLE_MS);
    };

    // A finger on the board lands a glide at once and takes over from there.
    const onPointerDown = () => glideRef.current?.land();

    let swiped = 0;
    let quietUntil = 0;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const fine = window.matchMedia(FINE_POINTER);
    const onWheel = (e: WheelEvent) => {
      if (!fine.matches || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      // Also keeps the browser's own back/forward swipe out of it.
      e.preventDefault();
      const now = performance.now();
      clearTimeout(quiet);
      quiet = setTimeout(() => (swiped = 0), WHEEL_QUIET_MS);
      // The momentum tail of a swipe that already turned the page is not a new swipe.
      if (now < quietUntil) {
        quietUntil = now + WHEEL_QUIET_MS;
        return;
      }
      swiped += e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      if (Math.abs(swiped) < WHEEL_TURN_PX) return;
      const to = Math.max(0, Math.min(4, dayRef.current + Math.sign(swiped)));
      swiped = 0;
      quietUntil = now + WHEEL_QUIET_MS;
      if (to !== dayRef.current) glideTo(to);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("scrollend", settle);
    el.addEventListener("pointerdown", onPointerDown, { passive: true });
    el.addEventListener("touchstart", onPointerDown, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      clearTimeout(idle);
      clearTimeout(quiet);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", settle);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("touchstart", onPointerDown);
      el.removeEventListener("wheel", onWheel);
    };
  }, [ready, commit, glideTo, setPreview]);

  /** The dock, the arrow keys and links come through here. */
  const goToDay = useCallback((day: number) => glideTo(day), [glideTo]);

  return { scrollerRef, goToDay };
}
