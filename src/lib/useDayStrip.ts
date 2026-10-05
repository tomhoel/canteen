import { useEffect, useRef } from "react";

/**
 * The day strip: the browser scrolls and snaps, this only reads and steers it.
 *
 * Replaces useDaySwipe (axis lock, per-frame transform writes, a neighbor panel
 * mounted mid-gesture). With scroll-snap the gesture, momentum, rubber band and
 * snapping run on the compositor, and the neighbor is already in the DOM.
 */

/**
 * The day whose panel starts closest to `scrollLeft`. `lefts` are the panels'
 * start offsets, measured rather than computed so the gap and any desktop
 * padding are accounted for. Ties and overscroll resolve toward the earlier day
 * and the ends of the week respectively.
 */
export function nearestDay(scrollLeft: number, lefts: number[]): number {
  let best = 0;
  for (let i = 1; i < lefts.length; i++) {
    if (Math.abs(lefts[i] - scrollLeft) < Math.abs(lefts[best] - scrollLeft)) best = i;
  }
  return best;
}

function panelLefts(track: HTMLElement): number[] {
  const kids = Array.from(track.children) as HTMLElement[];
  const origin = kids[0]?.offsetLeft ?? 0;
  return kids.map((k) => k.offsetLeft - origin);
}

/** Without `scrollend` the day is committed once scroll events stop for this long. */
const SCROLL_IDLE_MS = 150;
const HAS_SCROLLEND = typeof window !== "undefined" && "onscrollend" in window;

export interface UseDayStripOptions {
  selectedDay: number;
  onSelectDay: (day: number) => void;
  /** The day the strip is passing over, or null at rest; drives the day-bar pill. */
  onPreviewDay: (day: number | null) => void;
  /** True once the track element exists (the menu has loaded). */
  ready: boolean;
}

export function useDayStrip({ selectedDay, onSelectDay, onPreviewDay, ready }: UseDayStripOptions) {
  const trackRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef(selectedDay);
  /** True while a smooth scroll that WE started is in flight; its passing days are not previews. */
  const programmatic = useRef(false);
  const placed = useRef(false);
  const onSelectRef = useRef(onSelectDay);
  const onPreviewRef = useRef(onPreviewDay);

  useEffect(() => {
    selectedRef.current = selectedDay;
  }, [selectedDay]);

  useEffect(() => {
    onSelectRef.current = onSelectDay;
    onPreviewRef.current = onPreviewDay;
  }, [onSelectDay, onPreviewDay]);

  // Strip -> state: a finger or trackpad moved it.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const dayNow = () => nearestDay(el.scrollLeft, panelLefts(el));
    const commit = () => {
      programmatic.current = false;
      onPreviewRef.current(null);
      const day = dayNow();
      if (day !== selectedRef.current) onSelectRef.current(day);
    };
    const onScroll = () => {
      if (!programmatic.current) {
        const day = dayNow();
        onPreviewRef.current(day === selectedRef.current ? null : day);
      }
      if (!HAS_SCROLLEND) {
        clearTimeout(timer);
        timer = setTimeout(commit, SCROLL_IDLE_MS);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    if (HAS_SCROLLEND) el.addEventListener("scrollend", commit);
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("scrollend", commit);
    };
  }, [ready]);

  // State -> strip: a tap, arrow key, ?day= change or the seed moved selectedDay.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || !ready) return;
    const lefts = panelLefts(el);
    const at = nearestDay(el.scrollLeft, lefts);
    if (at === selectedDay) {
      placed.current = true;
      return;
    }
    // Only a one-day move is worth animating; a longer one would sweep across
    // panels that hold no cards, and the first placement must not slide at all.
    const smooth = placed.current && Math.abs(selectedDay - at) === 1;
    programmatic.current = smooth;
    el.scrollTo({ left: lefts[selectedDay], behavior: smooth ? "smooth" : "instant" });
    placed.current = true;
  }, [selectedDay, ready]);

  return { trackRef };
}
