import { AppHeader, ClosedCanteensPill } from "canteen";

/*
  The page's title block and its three entry points. The buttons are the only
  route to the week overview, the leaderboard and the about panel, so every
  story renders them — including the loading one, where they are present but
  inert so the header does not change size when the menu lands.
*/

const noop = () => {};
const actions = { onInfo: noop, onLeaderboard: noop, onWeekOverview: noop };

const frame = (children: React.ReactNode) => (
  <div style={{ width: 720, background: "var(--bg-cream, #f5f0e8)", padding: "8px 0" }}>
    {children}
  </div>
);

/** A live weekday: "Denne ukens Lunsj", with the day and date beneath. */
export const Weekday = () =>
  frame(
    <AppHeader mode="weekday-current" displayWeek={37} dayLabel="Mandag" dateStr="8. september" actions={actions} />
  );

/** The weekend, showing next week — the title changes to "Neste ukes Lunsj". */
export const WeekendPreview = () =>
  frame(
    <AppHeader mode="weekend-preview" displayWeek={37} dayLabel="Mandag" dateStr="7. september" actions={actions} />
  );

/** A week the user pinned via ?week=, rather than one derived from today. */
export const PinnedWeek = () =>
  frame(
    <AppHeader mode="pinned-week" displayWeek={40} dayLabel="Onsdag" dateStr="1. oktober" actions={actions} />
  );

/**
 * With the closed-canteens pill, which the header takes as children because it
 * only exists once the menu is known.
 */
export const WithClosedPill = () =>
  frame(
    <AppHeader mode="weekday-current" displayWeek={37} dayLabel="Tirsdag" dateStr="9. september" actions={actions}>
      <ClosedCanteensPill
        closedCanteens={[{ canteenName: "Kantine M", canteen: { week: "Uke/week 37", openingHours: "10:30 - 13:00" } }]}
      />
    </AppHeader>
  );

/**
 * Loading. `actions` is omitted, so the buttons render but do nothing — the
 * header must occupy exactly the same box before and after the data arrives,
 * or every card below it moves.
 */
export const Loading = () =>
  frame(<AppHeader mode="weekday-current" displayWeek={37} dayLabel="Mandag" dateStr="8. september" />);
