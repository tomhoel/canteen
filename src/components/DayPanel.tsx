"use client";

import { memo } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";

/**
 * One weekday's cards, as one slide of the scroll-snap strip (`.cards-track`).
 *
 * All five exist so the strip's offsets never move; only `populated` ones hold
 * cards (the current day and its neighbors), which keeps a week's worth of plate
 * images from loading at once. Everything but the current day is `inert`: out of
 * the tab order, the accessibility tree and hit-testing, as a leaving panel was.
 */
export interface DayPanelProps {
  day: number;
  data: CanteenDayItem[];
  populated: boolean;
  current: boolean;
  todayIndex: number;
  votes: Record<string, number>;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  yoloHighlight: number;
  yoloWinner: number;
  /** True only for the first day shown after launch, enabling the entrance animation. */
  isInitial?: boolean;
}

function DayPanel({
  day,
  data,
  populated,
  current,
  todayIndex,
  votes,
  maxVotes,
  onImageClick,
  onCardClick,
  yoloHighlight,
  yoloWinner,
  isInitial = false,
}: DayPanelProps) {
  const openCanteens = data.filter((c) => !isCanteenClosed(c));
  const closedCanteens = data.filter((c) => isCanteenClosed(c));

  return (
    <div
      className={"cards-animated-wrapper day-panel" + (isInitial ? " day-panel-initial" : "")}
      data-day={day}
      inert={!current || undefined}
    >
      {!populated ? null : openCanteens.length === 0 ? (
        <AllClosedCard closedCanteens={closedCanteens} />
      ) : (
        data.map((d, cardIdx) =>
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
              isInitial={isInitial}
            />
          )
        )
      )}
    </div>
  );
}

export default memo(DayPanel);
