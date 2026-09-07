"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";

/**
 * One weekday's cards, and its own arrival or departure.
 *
 * This is the half of the day change `<AnimatePresence mode="popLayout">` used
 * to own. It is a component taking its OWN `day` because the leaving panel has
 * to keep rendering the day it is leaving with: FoodCard keys `.card-content`
 * on `selectedDay` and decides the vote affordance from it, so handing the
 * outgoing panel the app's new day would replay the card-content entrance and
 * flip the vote button on a panel already on its way out.
 *
 * ── How the two days overlap ──
 *
 * They do not need absolute positioning. `.cards-track` is already a CSS grid
 * whose children are pinned to `grid-column: 1; grid-row: 1` — the stylesheet
 * calls it a "CSS Grid Stack to prevent height jumping during transitions" —
 * so two panels rendered as siblings land in the same cell and overlap on
 * their own. Measured on the real page: inserting a second panel left the
 * track height at 1013px and the original panel's top at 341px, both
 * unchanged, with both panels at the same offset.
 *
 * That matters beyond tidiness. popLayout worked by pinning the outgoing child
 * with `position: absolute !important` plus measured `top`/`left`, and any
 * hand-rolled version of that resolves against the grid AREA — which on
 * desktop is stretched to the full track height, so `top: 0` would snap the
 * leaving day ~110px upward on every change. Stacking sidesteps it entirely.
 *
 * ── Transitions, not keyframes ──
 *
 * A day change interrupted by another day change has to continue from wherever
 * the panel currently is. Swapping a running `@keyframes` entrance for an exit
 * jumps the panel back to its start in a single frame; a transition retargets
 * from the current value. The forced `offsetHeight` read below is the same
 * trick, for the same reason, as `ui/sheet.tsx` — and like sheet.tsx it flips
 * a piece of state inside the layout effect, because React flushes that
 * synchronously before paint. There is no scheduler gap to route around.
 */

/**
 * How long to wait before unmounting a leaving panel.
 *
 * The timer is the authority, not `transitionend`, for two reasons that are
 * each sufficient:
 *
 *  - A swipe-driven change sets `--day-dir: 0`, so the panel's `transform`
 *    never changes and no transform transition is generated at all.
 *  - `prefers-reduced-motion: reduce` turns every transition off with
 *    `!important`, so nothing fires. Without a timer the leaving day would
 *    stay mounted for ever, stacked over the new one.
 *
 * Longer than the 320ms slide so it never truncates a live transition.
 */
const EXIT_FALLBACK_MS = 360;

export type DayPanelPhase = "static" | "enter" | "exit";

export interface DayPanelProps {
  /** The weekday this panel shows — never the app's selectedDay while exiting. */
  day: number;
  data: CanteenDayItem[];
  /** "static" is the first day the app shows: already home, no entrance. */
  phase: DayPanelPhase;
  /**
   * 1 for a later day, -1 for an earlier one, 0 when a swipe already moved the
   * strip and this panel must not translate as well. Reaches CSS as
   * `--day-dir`; the distance and the desktop-only scale live in the
   * stylesheet.
   */
  dir: number;
  todayIndex: number;
  votes: Record<string, number>;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  yoloHighlight: number;
  yoloWinner: number;
  /** Fired once when the exit is over. Only passed to a leaving panel. */
  onExited?: () => void;
}

function DayPanel({
  day,
  data,
  phase,
  dir,
  todayIndex,
  votes,
  maxVotes,
  onImageClick,
  onCardClick,
  yoloHighlight,
  yoloWinner,
  onExited,
}: DayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(phase !== "enter");

  // Release the entrance one commit after mount, with the "from" style already
  // resolved. Same shape as ui/sheet.tsx:120-126.
  useLayoutEffect(() => {
    if (phase !== "enter" || entered) return;
    const el = ref.current;
    if (el) void el.offsetHeight;
    setEntered(true);
  }, [phase, entered]);

  // The leaving panel's own countdown. Kept in a ref so a re-render during the
  // exit (a vote landing, a background description refresh) cannot restart it.
  const onExitedRef = useRef(onExited);
  useEffect(() => {
    onExitedRef.current = onExited;
  });

  useEffect(() => {
    if (phase !== "exit") return;
    const t = setTimeout(() => onExitedRef.current?.(), EXIT_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const openCanteens = data.filter((c) => !isCanteenClosed(c));
  const closedCanteens = data.filter((c) => isCanteenClosed(c));

  const cls =
    "cards-animated-wrapper day-panel" +
    (phase === "exit" ? " day-panel-exit" : !entered ? " day-panel-enter" : "");

  return (
    <div
      ref={ref}
      className={cls}
      style={{ "--day-dir": dir } as React.CSSProperties}
      /*
        `inert`, not `aria-hidden` plus `pointer-events: none`. The panel stays
        mounted and interactive for up to 360ms after it stops being the
        current day, and `inert` is the one attribute that takes it out of the
        tab order, the accessibility tree and hit-testing together. The app
        already uses it for exactly this state in useShellInert.
      */
      inert={phase === "exit" || undefined}
    >
      {openCanteens.length === 0 ? (
        <AllClosedCard closedCanteens={closedCanteens} />
      ) : (
        <>
          {closedCanteens.length > 0 && (
            <div className="closed-pill-mobile">
              <ClosedCanteensPill closedCanteens={closedCanteens} />
            </div>
          )}
          {data.map((d, cardIdx) =>
            isCanteenClosed(d) ? (
              <ClosedCard key={d.canteenName} data={d} cardIdx={cardIdx} />
            ) : (
              <FoodCard
                key={d.canteenName}
                data={d}
                cardIdx={cardIdx}
                selectedDay={day}
                todayIndex={todayIndex}
                voteCount={votes[d.canteenName] ?? 0}
                maxVotes={maxVotes}
                onImageClick={onImageClick}
                onCardClick={onCardClick}
                yoloHighlighted={yoloHighlight === cardIdx}
                yoloWinner={yoloWinner === cardIdx}
              />
            )
          )}
        </>
      )}
    </div>
  );
}

export default memo(DayPanel);
