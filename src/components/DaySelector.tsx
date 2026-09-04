import { useRef, useEffect, useLayoutEffect, useState, useCallback } from "react";
import { motion } from "motion/react";
import type { DisplayMode } from "@/lib/dateUtils";

interface DaySelectorProps {
  fullDayLabels: string[];
  dayLabelsData: string[];
  selectedDay: number;
  todayIndex: number;
  mode: DisplayMode;
  onDaySelect: (i: number) => void;
  /** Preload pictures for a day when hovered or touched */
  onDayHover?: (i: number) => void;
  /** Tapping the Today button always fires this in addition to onDaySelect.
      Used to trigger the YOLO randomiser from the day bar itself. */
  onTodayPress?: () => void;
  cardsRef?: React.RefObject<HTMLElement | null>;
  /** Canteens with no menu in the previewed week. Named in the banner so an
      absent card reads as "not published yet" rather than as a missing card. */
  pendingCanteens?: string[];
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
  onTodayPress,
  cardsRef,
  pendingCanteens = [],
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
      {mode !== "weekday-current" && (
        <div className="day-bar-banner" role="status">
          {mode === "weekend-preview"
            ? (`Forhåndsvisning av neste uke${
                    pendingCanteens.length
                      ? ` — ${pendingCanteens.join(", ")} har ikke publisert ennå`
                      : ""
                  }`)
            : mode === "pinned-week"
            // A week reached by ?week=. Say so, or the dates in the strip look
            // like a bug rather than an answer to what was asked for.
            ? ("Du ser på en annen uke")
            : ("Helg — kantinene er stengt")}
        </div>
      )}
      <div className="day-selector" role="tablist" ref={selectorRef}>
        {pill && (
          <motion.div
            className="day-pill"
            initial={false}
            animate={{
              x: pill.left,
              width: pill.width,
            }}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 34,
              mass: 0.65,
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
            onClick={() => {
              // YOLO fires only on a second tap of Today (i.e. user is
              // already on today and tapped it again). First tap from
              // another day just navigates, no spin.
              const isYoloTap = i === todayIndex && selectedDay === todayIndex;
              onDaySelect(i);
              if (isYoloTap) onTodayPress?.();
            }}
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
