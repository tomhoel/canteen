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
  return (
    <nav className={`day-bar${hasAheadCanteens ? " has-ahead" : ""}`}>
      <div className="day-selector">
        {fullDayLabels.map((dayName, i) => {
          const dateLabel = dayLabelsData[i];
          return (
            <button
              key={i}
              className={`day-btn ${selectedDay === i ? "active" : ""} ${i === todayIndex ? "today" : ""}`}
              onClick={() => onDaySelect(i)}
            >
              <span className="day-label-name">{dayName}</span>
              <span className="day-label-date">
                {i === todayIndex ? (lang === "no" ? "I dag" : "Today") : dateLabel}
              </span>
              {hasAheadCanteens && i !== todayIndex && (
                <span className="ahead-dot" />
              )}
            </button>
          );
        })}
      </div>
      {hasAheadCanteens && (
        <div className="ahead-bar-hint">
          {lang === "no" ? "Viser neste ukes meny" : "Showing next week's menu"}
        </div>
      )}
    </nav>
  );
}
