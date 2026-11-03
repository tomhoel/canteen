import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";

import type { DisplayMode } from "@/lib/dateUtils";
import { onDayProgress } from "@/lib/day-progress";

interface DaySelectorProps {
  fullDayLabels: string[];
  dayLabelsData: string[];
  selectedDay: number;
  todayIndex: number;
  mode: DisplayMode;
  onDaySelect: (i: number) => void;
  /** Preload pictures for a day when hovered or touched */
  onDayHover?: (i: number) => void;
  cardsRef?: React.RefObject<HTMLElement | null>;
  /** Set while the menu is loading. The bar still renders — it holds the same
      space and shows the same dates either way — but there is no day to change
      to yet, and the selection would be thrown away when the data arrives. */
  disabled?: boolean;
}

export default function DaySelector({
  fullDayLabels,
  dayLabelsData,
  selectedDay,
  todayIndex,
  mode,
  onDaySelect,
  onDayHover,
  cardsRef,
  disabled = false,
}: DaySelectorProps) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [dynamicBottom, setDynamicBottom] = useState<number | null>(null);

  const updatePill = useCallback(() => {
    const container = selectorRef.current;
    const btn = btnRefs.current[selectedDay];
    if (!container || !btn) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();

    setPill({
      left: btnRect.left - containerRect.left,
      width: btnRect.width,
    });
  }, [selectedDay]);

  useLayoutEffect(() => {
    updatePill();
  }, [selectedDay, fullDayLabels.length, updatePill]);

  useEffect(() => {
    window.addEventListener("resize", updatePill);
    return () => window.removeEventListener("resize", updatePill);
  }, [updatePill]);

  /**
   * The highlight rides between two days in step with the board, whether a
   * finger, a trackpad or a smooth scroll from a tap is moving it. It is written
   * straight to the element on every scroll event, without a render, and
   * React's own value for it agrees once the day is committed.
   */
  const pillRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      onDayProgress((p) => {
        const el = pillRef.current;
        const container = selectorRef.current;
        if (!el || !container) return;
        // A glide hands the pill back to React and its stylesheet transition.
        if (!p) {
          el.style.transition = "";
          return;
        }
        const base = container.getBoundingClientRect().left;
        const place = (left: number, width: number) => {
          el.style.transform = `translateX(${left - base}px)`;
          // Width is layout; writing it on every scroll event forced a reflow
          // per frame even when the two buttons are the same width.
          const w = `${Math.round(width)}px`;
          if (el.style.width !== w) el.style.width = w;
        };
        const a = btnRefs.current[p.from]?.getBoundingClientRect();
        if (!a) return;
        const b = btnRefs.current[p.from + Math.sign(p.progress)]?.getBoundingClientRect() ?? a;
        const t = Math.abs(p.progress);
        el.style.transition = "none";
        place(a.left + (b.left - a.left) * t, a.width + (b.width - a.width) * t);
      }),
    []
  );

  // Desktop only: center between bottom of food cards and viewport bottom
  const updateDynamicBottom = useCallback(() => {
    const isDesktop = window.matchMedia("(min-width: 769px)").matches;
    if (!isDesktop || !cardsRef?.current || !barRef.current) {
      setDynamicBottom(null);
      return;
    }
    const barHeight = barRef.current.offsetHeight;
    const viewportH = window.innerHeight;
    const lastCard = cardsRef.current.querySelector(".cards-animated-wrapper")?.lastElementChild;
    const cardsBottom = lastCard
      ? lastCard.getBoundingClientRect().bottom
      : cardsRef.current.getBoundingClientRect().bottom;
    const gap = viewportH - cardsBottom;
    if (gap <= barHeight + 16) {
      setDynamicBottom(16);
    } else {
      setDynamicBottom((gap - barHeight) / 2);
    }
  }, [cardsRef]);

  // Layout effect, not effect: this runs before the browser paints, so the bar
  // is never shown at the CSS fallback and then moved. With a plain useEffect
  // React committed the bar at `bottom: 120px`, painted it, and only then
  // applied the measurement — one frame of the bar sitting visibly too low on
  // every single mount.
  useLayoutEffect(() => {
    updateDynamicBottom();
  }, [updateDynamicBottom]);

  // The measurement is desktop-only, so the listeners are too. A capture-phase
  // window scroll listener fires on every frame of every scroll a phone makes,
  // and this one existed to run a matchMedia check and return — plus a
  // ResizeObserver on the card container that no phone ever acts on.
  useEffect(() => {
    if (!window.matchMedia("(min-width: 769px)").matches) return;

    window.addEventListener("resize", updateDynamicBottom);
    window.addEventListener("scroll", updateDynamicBottom, true);
    const observer = cardsRef?.current ? new ResizeObserver(updateDynamicBottom) : null;
    if (cardsRef?.current && observer) observer.observe(cardsRef.current);
    return () => {
      window.removeEventListener("resize", updateDynamicBottom);
      window.removeEventListener("scroll", updateDynamicBottom, true);
      observer?.disconnect();
    };
  }, [updateDynamicBottom, cardsRef]);

  return (
    <nav
      ref={barRef}
      className={`day-bar day-bar-${mode}`}
      aria-label={"Velg dag"}
      style={dynamicBottom != null ? { bottom: dynamicBottom } : undefined}
    >
      <div className="day-selector" role="tablist" ref={selectorRef}>
        {pill && (
          /*
            The pill was a motion spring (380/34/0.65). Its damping ratio is
            1.08 — over-damped, so it never overshot and a cubic-bezier is the
            same movement; the curve lives on `.day-pill` in the stylesheet.

            `initial={false}` came for free and did not need reproducing. The
            element is inserted with its inline transform already set, in the
            same commit `updatePill` measures it (a useLayoutEffect, so before
            paint), and a CSS transition cannot run on an element's very first
            style. So there is no slide-in from the left edge here or on
            LoadingScreen, which mounts this same component. The one way to
            break that is to render the pill unconditionally with a
            `{ left: 0, width: 0 }` default — hence `pill &&`.
          */
          <div
            ref={pillRef}
            className="day-pill"
            style={{
              transform: `translateX(${pill.left}px)`,
              width: pill.width,
            }}
            aria-hidden="true"
          />
        )}
        {fullDayLabels.map((dayName, i) => (
          <button
            key={i}
            role="tab"
            ref={(el) => { btnRefs.current[i] = el; }}
            className={`day-btn ${selectedDay === i ? "active" : ""} ${i === todayIndex ? "today" : ""}`}
            aria-selected={selectedDay === i}
            aria-current={i === todayIndex ? "date" : undefined}
            disabled={disabled}
            onMouseEnter={() => onDayHover?.(i)}
            onTouchStart={() => onDayHover?.(i)}
            onClick={() => onDaySelect(i)}
          >
            <span className="day-label-name">{dayName}</span>
            <span className="day-label-date">
              {dayLabelsData[i]}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
