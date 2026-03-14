import { useRef, useEffect, useState, useCallback } from "react";

interface DaySelectorProps {
  fullDayLabels: string[];
  dayLabelsData: string[];
  selectedDay: number;
  todayIndex: number;
  lang: "no" | "en";
  hasAheadCanteens: boolean;
  onDaySelect: (i: number) => void;
  cardsRef?: React.RefObject<HTMLElement | null>;
}

export default function DaySelector({
  fullDayLabels,
  dayLabelsData,
  selectedDay,
  todayIndex,
  lang,
  hasAheadCanteens,
  onDaySelect,
  cardsRef,
}: DaySelectorProps) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [animated, setAnimated] = useState(false);
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

  useEffect(() => {
    updatePill();
    if (!animated) {
      requestAnimationFrame(() => setAnimated(true));
    }
  }, [selectedDay, fullDayLabels.length, lang, animated, updatePill]);

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

  useEffect(() => {
    updateDynamicBottom();
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
      className={`day-bar${hasAheadCanteens ? " has-ahead" : ""}`}
      aria-label="Day selection"
      style={dynamicBottom != null ? { bottom: dynamicBottom } : undefined}
    >
      <div className="day-selector" role="tablist" ref={selectorRef}>
        {pill && (
          <div
            className={`day-pill${animated ? " day-pill-animated" : ""}`}
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
