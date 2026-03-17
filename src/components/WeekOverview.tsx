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

function getDishEmoji(dish: string | undefined): string {
  if (!dish) return "🍽️";
  const d = dish.toLowerCase();
  if (/pasta|spagetti|spaghetti|tagliatelle|lasagne|penne|linguine|cannelloni|fettucine/.test(d)) return "🍝";
  if (/fisk|laks|torsk|sei|ørret|sild|reke|kveite|cod|salmon|fish|tuna|tunfisk|sjømat/.test(d)) return "🐟";
  if (/suppe|soup|bisque|chowder/.test(d)) return "🍲";
  if (/salat|salad/.test(d)) return "🥗";
  if (/burger|hamburger/.test(d)) return "🍔";
  if (/pizza/.test(d)) return "🍕";
  if (/kylling|chicken|kalkun|turkey|fjærkre/.test(d)) return "🍗";
  if (/biff|kjøtt|stek|beef|steak|lam|lamb|svin|pork|ribbe|schnitzel|kjøttkake/.test(d)) return "🥩";
  if (/veg|grønn|vegetar|tofu/.test(d)) return "🥦";
  if (/ris|rice/.test(d)) return "🍚";
  if (/wrap|taco/.test(d)) return "🌮";
  if (/wok|nudl|noodle/.test(d)) return "🥢";
  if (/curry/.test(d)) return "🍛";
  if (/egg/.test(d)) return "🍳";
  if (/sandwich|smørbrød|bagel/.test(d)) return "🥪";
  return "🍽️";
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
  const [isNarrow, setIsNarrow] = useState(false);

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
    <div className="week-overlay" role="presentation" onClick={onClose}>
      <div
        className="week-modal"
        role="dialog"
        aria-modal="true"
        aria-label={lang === "no" ? "Ukeoversikt" : "Week overview"}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="week-modal-header">
          <span className="week-modal-title">
            {lang === "no" ? "Ukeoversikt" : "Week overview"}
          </span>
          <button
            className="info-close"
            onClick={onClose}
            aria-label={lang === "no" ? "Lukk" : "Close"}
          >
            &times;
          </button>
        </div>

        {isNarrow ? (
          /* ── Narrow phones: canteen tabs + day list ── */
          <div className="week-mobile">
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
                          <span className="week-today-badge">{lang === "no" ? "I dag" : "Today"}</span>
                        )}
                        {isSelected && (
                          <span className="week-viewing-badge">{lang === "no" ? "Viser" : "Viewing"}</span>
                        )}
                      </span>
                      <span className="week-day-item-date">{dayLabelsData[di]}</span>
                    </div>
                    <div className="week-day-item-dish">
                      {!outdated && item.mainDish?.dish && (
                        <span className="week-day-emoji" aria-hidden="true">
                          {getDishEmoji(item.mainDish.dish)}
                        </span>
                      )}
                      {item.mainDish?.dish || (closed ? (lang === "no" ? "Stengt" : "Closed") : "")}
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
            {canteenNames.map((canteenName, ci) => (
              <div
                key={canteenName}
                className="week-row"
                style={{ "--row-idx": ci } as React.CSSProperties}
              >
                <div className="week-canteen-label">{canteenName}</div>
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
                      {!outdated && item.mainDish?.dish && (
                        <div className="week-cell-emoji" aria-hidden="true">
                          {getDishEmoji(item.mainDish.dish)}
                        </div>
                      )}
                      <div className="week-cell-dish">
                        {item.mainDish?.dish || (closed ? (lang === "no" ? "Stengt" : "Closed") : "")}
                      </div>
                      {!outdated && item.sideDishes.length > 0 && (
                        <div className="week-cell-extras">
                          +{item.sideDishes.length}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
