"use client";

import { memo, useState } from "react";
import type { CanteenDayItem } from "@/lib/types";
import { isCanteenClosed } from "@/lib/canteen-utils";
import FoodCard from "@/components/FoodCard";
import ClosedCard from "@/components/ClosedCard";
import AllClosedCard from "@/components/AllClosedCard";

/**
 * One weekday's cards, as one slide of the scroll-snap strip (`.cards-track`).
 *
 * All five hold their cards, so a fast swipe never lands on an empty panel; only
 * the days `near` the strip fetch their plate images, which keeps a week's worth
 * of pictures from loading at once. Everything but the current day is `inert`:
 * out of the tab order, the accessibility tree and hit-testing.
 */
export interface DayPanelProps {
  day: number;
  data: CanteenDayItem[];
  /** Within one day of where the strip is: this panel's plates may load. */
  near: boolean;
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
  near,
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
  // Once a panel's plates have been asked for they stay on: scrolling away must
  // not tear down pictures that are already decoded.
  const [imagesOn, setImagesOn] = useState(near);
  if (near && !imagesOn) setImagesOn(true);

  const openCanteens = data.filter((c) => !isCanteenClosed(c));
  const closedCanteens = data.filter((c) => isCanteenClosed(c));

  return (
    <div
      className={"cards-animated-wrapper day-panel" + (isInitial ? " day-panel-initial" : "")}
      data-day={day}
      inert={!current || undefined}
    >
      {openCanteens.length === 0 ? (
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
              showImage={imagesOn}
            />
          )
        )
      )}
    </div>
  );
}

export default memo(DayPanel);
