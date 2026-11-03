"use client";

import { memo } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";

/**
 * One weekday's cards: one page of the day board.
 *
 * All five sit side by side in `.cards-track`, a native snapping scroller (see
 * useDayScroller), so changing the day is the browser scrolling the board and
 * no panel ever animates on its own.
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
  /** Not the committed day: on the board, but out of reach until it is. */
  inactive?: boolean;
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
  inactive = false,
  isInitial = false,
}: DayPanelProps) {
  const openCanteens = data.filter((c) => !isCanteenClosed(c));
  const closedCanteens = data.filter((c) => isCanteenClosed(c));

  const cls = "cards-animated-wrapper day-panel" + (isInitial ? " day-panel-initial" : "");

  return (
    <div
      className={cls}
      /*
        `inert`, not `aria-hidden` plus `pointer-events: none`: the other days
        are on the board but not the day, and `inert` takes them out of the tab
        order, the accessibility tree and hit-testing together. A touch on one
        falls through to the scroller, so it still drags the board.
      */
      inert={inactive || undefined}
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
