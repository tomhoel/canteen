import { useRef } from "react";
import { useSearch } from "@/lib/useSearch";
import { DAY_KEYS, FULL_DAYS_NO } from "@/lib/constants";
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
export default function LoadingScreen() {
  const search = useSearch();
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

  const fullDayLabels = FULL_DAYS_NO;

  return (
    <div className="app-wrapper">
      <AppHeader
        mode={mode}
        displayWeek={weekNumber}
        dayLabel={fullDayLabels[selectedDay]}
        dateStr={formatLongDate(anchor, selectedDay)}
      />

      <main
        className="cards-container"
        ref={cardsRef}
        role="status"
        aria-busy="true"
        aria-label={"Laster menyer"}
      >
        {/*
          `.cards-track > .cards-board` is not decoration. Every sizing rule
          for a day is scoped as `.cards-board > .cards-animated-wrapper`, the
          board HomeClient renders; outside it the skeleton row loses its
          width, gap and (on a phone) its height, and the cards jump when the
          menu arrives — the jump this component and SkeletonCard exist to
          prevent. So the loading shell renders the same two wrappers.
        */}
        <div className="cards-track">
          <div className="cards-board">
            <div className="cards-animated-wrapper">
              {Array.from({ length: CARD_COUNT }, (_, i) => (
                <SkeletonCard key={i} delay={i * 75} />
              ))}
            </div>
          </div>
        </div>
      </main>

      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={weekDayLabels(anchor)}
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        mode={mode}
        onDaySelect={() => {}}
        cardsRef={cardsRef}
        disabled
      />
    </div>
  );
}
