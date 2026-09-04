import type { ReactNode } from "react";
import type { DisplayMode } from "@/lib/dateUtils";
import { Info, Trophy, CalendarDays } from "lucide-react";

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
          aria-label={lang === "no" ? "Om appen" : "About"}
        >
          <Info size={16} strokeWidth={2} />
        </button>
        <button
          className="info-btn"
          onClick={actions?.onLeaderboard}
          disabled={disabled}
          title={lang === "no" ? "Kantineseiere" : "Canteen wins"}
          aria-label={lang === "no" ? "Kantineseiere" : "Canteen wins"}
        >
          <Trophy size={16} strokeWidth={2} />
        </button>
        <button
          className="info-btn"
          onClick={actions?.onWeekOverview}
          disabled={disabled}
          title={lang === "no" ? "Ukeoversikt" : "Week overview"}
          aria-label={lang === "no" ? "Ukeoversikt" : "Week overview"}
        >
          <CalendarDays size={16} strokeWidth={2} />
        </button>
      </div>
      {children}
    </header>
  );
}
