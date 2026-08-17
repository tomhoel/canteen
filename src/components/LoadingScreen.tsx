import { useRef } from "react";
import { useSearch } from "@tanstack/react-router";
import { DAY_KEYS, FULL_DAYS_NO, FULL_DAYS_EN } from "@/lib/constants";
import {
  computeDisplayContext,
  weekDayLabels,
  formatLongDate,
} from "@/lib/dateUtils";
import AppHeader from "@/components/AppHeader";
import DaySelector from "@/components/DaySelector";
import { SkeletonCard } from "@/components/SkeletonCard";

/** One placeholder per canteen. CANTEEN_ORDER has three and always has. */
const CARD_COUNT = 3;

/**
 * The one and only loading state.
 *
 * It renders the *real* app shell — the same `.app-wrapper`, the same
 * `AppHeader`, the same `.cards-container > .cards-animated-wrapper`, the same
 * `DaySelector` — with a `SkeletonCard` standing in each card slot. Nothing
 * moves when the menu arrives because nothing about the frame changes; only the
 * three cards are swapped for their loaded selves.
 *
 * It replaces two different placeholder screens that used to run back to back:
 * a hand-rolled CSS grid in the route's pendingComponent (which, by importing
 * the default export of SkeletonCard.tsx — a *group* of three — and rendering
 * it three times, put nine cards on screen inside three horizontally scrolling
 * boxes), and a headerless skeleton inside HomeClient. Neither shared a layout
 * with the app, so the cards landed somewhere else entirely once loaded.
 *
 * Everything shown here is calendar-derived, so it is already correct before
 * the request finishes: the week number, the weekday, the dates in the strip.
 * The only value that can still change is the weekend preview/recap mode, which
 * depends on whether the canteens have published next week — and that swaps
 * text inside boxes that keep their size.
 */
export default function LoadingScreen({ lang = "no" }: { lang?: "no" | "en" }) {
  const search = useSearch({ strict: false }) as { day?: string; week?: string };
  const cardsRef = useRef<HTMLElement>(null);

  const { mode, weekNumber, todayIndex, defaultSelectedDay, anchor } =
    computeDisplayContext([], search?.week);

  // Mirrors HomeClient: an explicit ?day= wins, otherwise the mode's own
  // default. Landing on the same day the loaded app will land on is what keeps
  // the date in the header and the highlighted tab from changing under the user.
  const dayFromSearch = search?.day
    ? DAY_KEYS.indexOf(search.day.toLowerCase() as (typeof DAY_KEYS)[number])
    : -1;
  const selectedDay = dayFromSearch >= 0 ? dayFromSearch : defaultSelectedDay;

  const fullDayLabels = lang === "no" ? FULL_DAYS_NO : FULL_DAYS_EN;

  return (
    <div className="app-wrapper">
      <AppHeader
        mode={mode}
        lang={lang}
        displayWeek={weekNumber}
        dayLabel={fullDayLabels[selectedDay]}
        dateStr={formatLongDate(anchor, selectedDay, lang)}
      />

      <main
        className="cards-container"
        ref={cardsRef}
        role="status"
        aria-busy="true"
        aria-label={lang === "no" ? "Laster menyer" : "Loading menus"}
      >
        <div className="cards-animated-wrapper">
          {Array.from({ length: CARD_COUNT }, (_, i) => (
            <SkeletonCard key={i} delay={i * 75} />
          ))}
        </div>
      </main>

      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={weekDayLabels(anchor)}
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        lang={lang}
        mode={mode}
        onDaySelect={() => {}}
        cardsRef={cardsRef}
        disabled
      />
    </div>
  );
}
