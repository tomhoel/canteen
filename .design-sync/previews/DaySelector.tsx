import { DaySelector } from "canteen";

/*
  The day bar has three modes and they are genuinely different components to
  look at: which day is selected, whether any day is "today", and whether a
  banner sits above the row. Each mode is its own story for that reason.
*/

import type React from "react";

const DAYS = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"];
const noop = () => {};


/*
  The bar is `position: fixed; bottom: 120px` — in the app it floats over the
  card column, anchored to the viewport. Dropped straight into a preview cell it
  anchors to the *page* instead and leaves the card entirely, which is why every
  cell first captured blank.

  A transform on an ancestor makes that ancestor the containing block for fixed
  descendants, so this frame catches it. The height keeps the real 120px gap
  beneath the bar, and the width is a phone — this is where the component
  actually lives.
*/
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      position: "relative",
      transform: "translateZ(0)",
      width: 560,
      height: 240,
      background: "var(--bg-cream, #f5f0e8)",
      borderRadius: 12,
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

const base = {
  fullDayLabels: DAYS,
  onDaySelect: noop,
};

/** A live weekday. Today is Wednesday and it is the selected day. */
export const Weekday = () => (
  <Frame><DaySelector
    {...base}
    dayLabelsData={["01.09", "02.09", "03.09", "04.09", "05.09"]}
    selectedDay={2}
    todayIndex={2}
    mode="weekday-current"
  /></Frame>
);

/**
 * A weekday where the user has browsed away from today. The pill follows the
 * selection; "today" keeps its own quieter marker.
 */
export const WeekdayBrowsedAway = () => (
  <Frame><DaySelector
    {...base}
    dayLabelsData={["01.09", "02.09", "03.09", "04.09", "05.09"]}
    selectedDay={4}
    todayIndex={2}
    mode="weekday-current"
  /></Frame>
);

/**
 * Saturday, with next week already published. No day is today, so the bar
 * opens on Monday and says so in the banner.
 */
export const WeekendPreview = () => (
  <Frame><DaySelector
    {...base}
    dayLabelsData={["07.09", "08.09", "09.09", "10.09", "11.09"]}
    selectedDay={0}
    todayIndex={-1}
    mode="weekend-preview"
  /></Frame>
);

/**
 * The same weekend, but one kitchen has not published yet. Naming it in the
 * banner is what makes an absent card read as "not published" rather than as
 * a card that failed to load.
 */
export const WeekendPreviewPending = () => (
  <Frame><DaySelector
    {...base}
    dayLabelsData={["07.09", "08.09", "09.09", "10.09", "11.09"]}
    selectedDay={0}
    todayIndex={-1}
    mode="weekend-preview"
    pendingCanteens={["Kantine M"]}
  /></Frame>
);

/** While the menu loads. Same box, same dates, nothing to select yet. */
export const Disabled = () => (
  <Frame><DaySelector
    {...base}
    dayLabelsData={["07.09", "08.09", "09.09", "10.09", "11.09"]}
    selectedDay={0}
    todayIndex={-1}
    mode="weekend-preview"
    disabled
  /></Frame>
);
