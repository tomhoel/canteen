"use client";

import { useState, useEffect, useCallback } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import { getCanteenMetadata } from "@/lib/constants";
import "@/styles/week-overview.css";
import { useShellInert } from "@/lib/useShellInert";

const DAYS_ABBR_NO = ["Man", "Tir", "Ons", "Tor", "Fre"];

interface WeekOverviewProps {
  allDaysData: CanteenDayItem[][];   // [dayIndex][canteenIndex]
  selectedDay: number;
  todayIndex: number;
  dayLabelsData: string[];           // ["17.03", "18.03", ...]
  fullDayLabels: string[];           // ["Mandag", ...] or ["Monday", ...]
  onDaySelect: (i: number) => void;
  onClose: () => void;
}

const isClosed = isCanteenClosed;

export default function WeekOverview({
  allDaysData,
  selectedDay,
  todayIndex,
  dayLabelsData,
  fullDayLabels,
  onDaySelect,
  onClose,
}: WeekOverviewProps) {
  const [activeCanteenTab, setActiveCanteenTab] = useState(0);
  // Read synchronously, not in the effect. Initialising to `false` meant every
  // phone rendered the wide grid for one frame and then swapped to the tab
  // layout — a guaranteed flash on every open.
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 520px)");
    setIsNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const handleCellClick = useCallback((dayIndex: number) => {
    onDaySelect(dayIndex);
    onClose();
  }, [onDaySelect, onClose]);

  const daysAbbr = DAYS_ABBR_NO;

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

  // Keeps the page behind this overlay out of the tab order. Measured before
  // this: 8 focusable elements were still reachable underneath.
  useShellInert();

  return (
    <div className="week-overlay" role="presentation" onClick={onClose}>
      <div
        className="week-modal"
        role="dialog"
        aria-modal="true"
        aria-label={"Ukeoversikt"}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="week-modal-header">
          <span className="week-modal-title">
            {"Ukeoversikt"}
          </span>
          <button
            className="info-close"
            onClick={onClose}
            aria-label={"Lukk"}
          >
            &times;
          </button>
        </div>

        {isNarrow ? (
          /* ── Narrow phones: canteen tabs + day list ── */
          <div className="week-mobile">
            <div className="week-tabs">
              {canteenNames.map((name, ci) => {
                const meta = getCanteenMetadata(name);
                return (
                  <button
                    key={name}
                    className={`week-tab${ci === activeCanteenTab ? " active" : ""}`}
                    onClick={() => setActiveCanteenTab(ci)}
                  >
                    {meta.name}
                  </button>
                );
              })}
            </div>
            <div className="week-day-list">
              {allDaysData.map((dayItems, di) => {
                const item = dayItems[activeCanteenTab];
                if (!item) return null;
                const closed = isClosed(item);
                const outdated = item.isOutdated || item.isAhead || closed;
                const isToday = di === todayIndex;
                const isSelected = di === selectedDay && !isToday;
                return (
                  <div
                    key={di}
                    style={{ "--day-idx": di } as React.CSSProperties}
                    className={`week-day-item${isToday ? " today" : ""}${isSelected ? " selected" : ""}${outdated ? " closed" : ""}`}
                    onClick={() => handleCellClick(di)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleCellClick(di); }}
                  >
                    <div className="week-day-item-label">
                      <span className="week-day-item-name">
                        {fullDayLabels[di]}
                        {isToday && (
                          <span className="week-today-badge">{"I dag"}</span>
                        )}
                      </span>
                      <span className="week-day-item-date">{dayLabelsData[di]}</span>
                    </div>
                    <div className="week-day-item-dish">
                      {item.mainDish?.dish || (closed ? ("Stengt") : "")}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ── Wider screens: 5-column grid ── */
          <div className="week-grid">
            <div className="week-col-headers">
              <div className="week-canteen-label-header" />
              {dayLabelsData.map((dateLabel, di) => (
                <div
                  key={di}
                  className={`week-col-header${di === todayIndex ? " today" : ""}${di === selectedDay && di !== todayIndex ? " selected" : ""}`}
                >
                  <span className="week-col-header-abbr">{daysAbbr[di]}</span>
                  <span className="week-col-header-date">{dateLabel}</span>
                </div>
              ))}
            </div>
            {canteenNames.map((canteenName, ci) => {
              const meta = getCanteenMetadata(canteenName);
              return (
                <div
                  key={canteenName}
                  className="week-row"
                  style={{ "--row-idx": ci } as React.CSSProperties}
                >
                  <div className="week-canteen-label">
                    <span>{meta.name}</span>
                    <span className="week-canteen-sub" style={{ display: "block", fontSize: "10px", color: "var(--text-muted)", fontWeight: 500 }}>
                      {meta.buildingShort}
                    </span>
                  </div>
                  {allDaysData.map((dayItems, di) => {
                    const item = dayItems[ci];
                    if (!item) return (
                      <div
                        key={di}
                        className="week-cell closed"
                        style={{ "--col-idx": di } as React.CSSProperties}
                      />
                    );
                  const closed = isClosed(item);
                  const outdated = item.isOutdated || item.isAhead || closed;
                  const isToday = di === todayIndex;
                  const isSelected = di === selectedDay && !isToday;
                  return (
                    <div
                      key={di}
                      style={{ "--col-idx": di } as React.CSSProperties}
                      className={`week-cell${isToday ? " today" : ""}${isSelected ? " selected" : ""}${outdated ? " closed" : ""}`}
                      onClick={() => handleCellClick(di)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") handleCellClick(di); }}
                    >
                      <div className="week-cell-dish">
                        {item.mainDish?.dish || (closed ? ("Stengt") : "")}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          </div>
        )}
      </div>
    </div>
  );
}
