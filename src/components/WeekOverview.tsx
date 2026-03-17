"use client";

import { useState, useEffect, useCallback } from "react";
import type { CanteenDayItem } from "@/lib/types";

const DAYS_ABBR_NO = ["Man", "Tir", "Ons", "Tor", "Fre"];
const DAYS_ABBR_EN = ["Mon", "Tue", "Wed", "Thu", "Fri"];

interface WeekOverviewProps {
  allDaysData: CanteenDayItem[][];   // [dayIndex][canteenIndex]
  selectedDay: number;
  todayIndex: number;
  dayLabelsData: string[];           // ["17.03", "18.03", ...]
  fullDayLabels: string[];           // ["Mandag", ...] or ["Monday", ...]
  lang: "no" | "en";
  onDaySelect: (i: number) => void;
  onClose: () => void;
}

function isClosed(item: CanteenDayItem): boolean {
  return !item.mainDish && (!item.items || item.items.length === 0);
}

export default function WeekOverview({
  allDaysData,
  selectedDay,
  todayIndex,
  dayLabelsData,
  fullDayLabels,
  lang,
  onDaySelect,
  onClose,
}: WeekOverviewProps) {
  const [activeCanteenTab, setActiveCanteenTab] = useState(0);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 769px)");
    setIsDesktop(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleCellClick = useCallback((dayIndex: number) => {
    onDaySelect(dayIndex);
    onClose();
  }, [onDaySelect, onClose]);

  const daysAbbr = lang === "no" ? DAYS_ABBR_NO : DAYS_ABBR_EN;

  // Gather canteen names from first day that has data
  const canteenNames: string[] = [];
  for (let d = 0; d < allDaysData.length; d++) {
    if (allDaysData[d] && allDaysData[d].length > 0) {
      allDaysData[d].forEach(item => {
        if (!canteenNames.includes(item.canteenName)) canteenNames.push(item.canteenName);
      });
      break;
    }
  }

  return (
    <>
      {/* Scrim */}
      <div className="week-overlay" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div
        className="week-panel open"
        role="dialog"
        aria-modal="true"
        aria-label={lang === "no" ? "Ukeoversikt" : "Week overview"}
      >
        {/* Handle (mobile only, via CSS) */}
        <div className="action-sheet-handle" />

        {/* Header */}
        <div className="week-panel-header">
          <span className="week-panel-title">
            {lang === "no" ? "Ukeoversikt" : "Week overview"}
          </span>
          <button
            className="week-close-btn"
            onClick={onClose}
            aria-label={lang === "no" ? "Lukk" : "Close"}
          >
            &times;
          </button>
        </div>

        {isDesktop ? (
          /* ── Desktop grid ── */
          <div className="week-grid-desktop">
            {/* Column headers */}
            <div className="week-col-headers">
              {/* Empty top-left cell for canteen labels column */}
              <div className="week-canteen-label-header" />
              {dayLabelsData.map((dateLabel, di) => (
                <div
                  key={di}
                  className={`week-col-header${di === todayIndex ? " today" : ""}`}
                >
                  <span className="week-col-header-abbr">{daysAbbr[di]}</span>
                  <span className="week-col-header-date">{dateLabel}</span>
                </div>
              ))}
            </div>

            {/* One row per canteen */}
            {canteenNames.map((canteenName, ci) => (
              <div key={canteenName} className="week-row">
                <div className="week-canteen-label">{canteenName}</div>
                {allDaysData.map((dayItems, di) => {
                  const item = dayItems[ci];
                  if (!item) return <div key={di} className="week-cell closed" />;
                  const closed = isClosed(item);
                  const outdated = item.isOutdated || item.isAhead || closed;
                  return (
                    <div
                      key={di}
                      className={`week-cell${di === todayIndex ? " today" : ""}${outdated ? " closed" : ""}`}
                      onClick={() => handleCellClick(di)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleCellClick(di); }}
                    >
                      <div className="week-cell-dish">
                        {item.mainDish?.dish || (closed ? (lang === "no" ? "Stengt" : "Closed") : "")}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          /* ── Mobile layout ── */
          <div className="week-mobile">
            {/* Canteen tabs */}
            <div className="week-tabs">
              {canteenNames.map((name, ci) => (
                <button
                  key={name}
                  className={`week-tab${ci === activeCanteenTab ? " active" : ""}`}
                  onClick={() => setActiveCanteenTab(ci)}
                >
                  {name}
                </button>
              ))}
            </div>

            {/* Day list */}
            <div className="week-day-list">
              {allDaysData.map((dayItems, di) => {
                const item = dayItems[activeCanteenTab];
                if (!item) return null;
                const closed = isClosed(item);
                const outdated = item.isOutdated || item.isAhead || closed;
                return (
                  <div
                    key={di}
                    className={`week-day-item${di === todayIndex ? " today" : ""}${outdated ? " closed" : ""}`}
                    onClick={() => handleCellClick(di)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleCellClick(di); }}
                  >
                    <div className="week-day-item-label">
                      <span className="week-day-item-name">
                        {fullDayLabels[di]}
                        {di === todayIndex && (
                          <span className="week-today-badge">{lang === "no" ? "I dag" : "Today"}</span>
                        )}
                      </span>
                      <span className="week-day-item-date">{dayLabelsData[di]}</span>
                    </div>
                    <div className="week-day-item-dish">
                      {item.mainDish?.dish || (closed ? (lang === "no" ? "Stengt" : "Closed") : "")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
