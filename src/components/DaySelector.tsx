import { useRef, useEffect, useState, useCallback } from "react";

interface DaySelectorProps {
  fullDayLabels: string[];
  dayLabelsData: string[];
  selectedDay: number;
  todayIndex: number;
  lang: "no" | "en";
  hasAheadCanteens: boolean;
  onDaySelect: (i: number) => void;
}

export default function DaySelector({
  fullDayLabels,
  dayLabelsData,
  selectedDay,
  todayIndex,
  lang,
  hasAheadCanteens,
  onDaySelect,
}: DaySelectorProps) {
  const selectorRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [animated, setAnimated] = useState(false);

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
  }, [selectedDay, fullDayLabels.length, animated, updatePill]);

  useEffect(() => {
    window.addEventListener("resize", updatePill);
    return () => window.removeEventListener("resize", updatePill);
  }, [updatePill]);

  return (
    <nav
      className={`day-bar${hasAheadCanteens ? " has-ahead" : ""}`}
      aria-label="Day selection"
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
