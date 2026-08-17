import type { ReactNode } from "react";
import type { DisplayMode } from "@/lib/dateUtils";

interface AppHeaderProps {
  mode: DisplayMode;
  lang: "no" | "en";
  displayWeek: number;
  /** Full name of the selected weekday, e.g. "Mandag". */
  dayLabel: string;
  /** The selected day's date, e.g. "17. august". */
  dateStr: string;
  /**
   * Left out while the menu is still loading.
   *
   * The buttons render either way: the header has to occupy exactly the same
   * box before and after the data arrives, or every card below it moves. They
   * are simply inert until there is something for them to open — a disabled
   * `.info-btn` is styled identically, so nothing about the header changes
   * visually when the menu lands.
   */
  actions?: {
    onInfo: () => void;
    onLeaderboard: () => void;
    onWeekOverview: () => void;
    onFeedback: () => void;
  };
  /** The closed-canteens pill, which only exists once the menu is known. */
  children?: ReactNode;
}

/**
 * The title block and the four header buttons.
 *
 * Extracted from HomeClient so the loading screen can render the identical
 * header rather than a copy of it. Everything it shows — the mode, the week
 * number, the weekday and the date — comes from the calendar via
 * computeDisplayContext, not from the menu, so it is just as true before the
 * request finishes as after.
 */
export default function AppHeader({
  mode,
  lang,
  displayWeek,
  dayLabel,
  dateStr,
  actions,
  children,
}: AppHeaderProps) {
  const disabled = !actions;

  return (
    <header className="app-header">
      <div className="hero-inline">
        <h1 className="hero-title">
          {mode === "weekday-current"
            ? (lang === "no" ? "Dagens" : "Today's")
            : mode === "weekend-preview"
            ? (lang === "no" ? "Neste ukes" : "Next week's")
            : mode === "pinned-week"
            ? (lang === "no" ? `Uke ${displayWeek}s` : `Week ${displayWeek}'s`)
            : (lang === "no" ? "Denne ukens" : "This week's")}{" "}
          <span>{lang === "no" ? "Lunsj" : "Lunch"}</span>
        </h1>
        <p className="hero-subtitle">
          {lang === "no" ? "Uke" : "Week"} {displayWeek} &bull; {dayLabel} {dateStr}
        </p>
      </div>
      <div className="header-actions">
        <button
          className="info-btn"
          onClick={actions?.onInfo}
          disabled={disabled}
          title={lang === "no" ? "Om appen" : "About"}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/><path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="4.75" r="0.65" fill="currentColor"/></svg>
        </button>
        <button
          className="info-btn"
          onClick={actions?.onLeaderboard}
          disabled={disabled}
          title={lang === "no" ? "Kantineseiere" : "Canteen wins"}
          aria-label={lang === "no" ? "Kantineseiere" : "Canteen wins"}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
            <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
            <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </button>
        <button
          className="info-btn"
          onClick={actions?.onWeekOverview}
          disabled={disabled}
          aria-label={lang === "no" ? "Ukeoversikt" : "Week overview"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
        <button
          className="info-btn"
          onClick={actions?.onFeedback}
          disabled={disabled}
          title="Ønsk en rett"
          aria-label="Ønsk en rett"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
      {children}
    </header>
  );
}
