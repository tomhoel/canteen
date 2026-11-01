"use client";

import { memo } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";

/**
 * One weekday's cards.
 *
 * Two of these can be on screen at once: the current day and, while a day
 * change is under way, the day it is changing to (`swipePosition`). They share
 * `.cards-track`'s single grid cell, so they overlap without any absolute
 * positioning; the neighbour's class offsets it one width plus a gap, and the
 * track's transform (written by useDaySwipe) moves both together. There is no
 * per-panel enter or exit animation any more: every day change is that one
 * movement of the track.
 */

export interface DayPanelProps {
  /** The weekday this panel shows. */
  day: number;
  data: CanteenDayItem[];
  todayIndex: number;
  votes: Record<string, number>;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  /** Mounted beside the current day during a change: -1 to its left, 1 to its right. */
  swipePosition?: -1 | 1;
  /** True only for the first day on screen, which plays the opening entrance. */
  isInitial?: boolean;
}

function DayPanel({
  day,
  data,
  todayIndex,
  votes,
  maxVotes,
  onImageClick,
  onCardClick,
  swipePosition,
  isInitial = false,
}: DayPanelProps) {
  const openCanteens = data.filter((c) => !isCanteenClosed(c));
  const closedCanteens = data.filter((c) => isCanteenClosed(c));

  const cls =
    "cards-animated-wrapper day-panel" +
    (isInitial ? " day-panel-initial" : "") +
    (swipePosition === -1
      ? " day-panel-neighbor-left"
      : swipePosition === 1
      ? " day-panel-neighbor-right"
      : "");

  return (
    <div
      className={cls}
      /*
        `inert`, not `aria-hidden` plus `pointer-events: none`: the neighbour is
        on screen but not yet the day, and `inert` takes it out of the tab
        order, the accessibility tree and hit-testing together.
      */
      inert={swipePosition !== undefined || undefined}
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
