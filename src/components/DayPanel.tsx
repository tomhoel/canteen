"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";

/**
 * One weekday's cards, and its own arrival or departure.
 *
 * The day change is the one the owner picked out of the app's history (the
 * 2026-09-18 build): on a desktop the leaving day slides 80px and fades while
 * the arriving one slides in from 80px, fades and settles from 98%; on a phone
 * a tap slides the whole day across, and a finger drags the track with the
 * neighbouring day mounted beside it (`swipePosition`).
 *
 * The panels share `.cards-track`'s single grid cell, so a leaving and an
 * arriving day overlap without absolute positioning. Transitions rather than
 * keyframes, so a change interrupted by another continues from where the panel
 * is instead of jumping to its start.
 */

/**
 * How long to wait before unmounting a leaving panel. The timer is the
 * authority, not `transitionend`: a swipe-driven change never transitions the
 * panel's transform, and reduced motion turns every transition off.
 * Longer than the 320ms slide so it never truncates a live transition.
 */
const EXIT_FALLBACK_MS = 360;

export type DayPanelPhase = "static" | "enter" | "exit";

export interface DayPanelProps {
  /** The weekday this panel shows — never the app's selectedDay while exiting. */
  day: number;
  data: CanteenDayItem[];
  /** "static" is a day already in place: the first one shown, or a swiped-in neighbour. */
  phase: DayPanelPhase;
  /**
   * 1 for a later day, -1 for an earlier one, 0 when a swipe already moved the
   * track and this panel must not translate as well. Reaches CSS as `--day-dir`.
   */
  dir: number;
  todayIndex: number;
  votes: Record<string, number>;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  /** Fired once when the exit is over. Only passed to a leaving panel. */
  onExited?: () => void;
  /** Mounted beside the current day during a finger swipe: -1 to its left, 1 to its right. */
  swipePosition?: -1 | 1;
  /** True only for the first day on screen, which plays the opening entrance. */
  isInitial?: boolean;
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
  onExited,
  swipePosition,
  isInitial = false,
}: DayPanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(phase !== "enter");

  // Release the entrance one commit after mount, with the "from" style already
  // resolved, so the transition has somewhere to start from.
  useLayoutEffect(() => {
    if (phase !== "enter" || entered) return;
    const el = ref.current;
    if (el) void el.offsetHeight;
    setEntered(true);
  }, [phase, entered]);

  // The leaving panel's own countdown, in a ref so a re-render during the exit
  // (a vote landing, say) cannot restart it.
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
    (isInitial ? " day-panel-initial" : "") +
    (swipePosition === -1
      ? " day-panel-neighbor-left"
      : swipePosition === 1
      ? " day-panel-neighbor-right"
      : phase === "exit"
      ? " day-panel-exit"
      : !entered
      ? " day-panel-enter"
      : "");

  return (
    <div
      ref={ref}
      className={cls}
      style={{ "--day-dir": dir } as React.CSSProperties}
      /*
        `inert`: a leaving or neighbouring day is on screen but not the day, and
        `inert` takes it out of the tab order, the accessibility tree and
        hit-testing together.
      */
      inert={phase === "exit" || swipePosition !== undefined || undefined}
    >
      {openCanteens.length === 0 ? (
        <AllClosedCard closedCanteens={closedCanteens} />
      ) : (
        <>
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
                isInitial={isInitial}
              />
            )
          )}
        </>
      )}
    </div>
  );
}

export default memo(DayPanel);
