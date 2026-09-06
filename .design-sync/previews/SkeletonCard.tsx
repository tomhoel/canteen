import { SkeletonCard } from "canteen";

/*
  The placeholder that holds a card's space while the menu loads. It must
  occupy the same box as a real FoodCard, which is the only thing worth
  checking here.
*/

/** One card's placeholder. */
export const Default = () => <SkeletonCard />;

/**
 * The row as it actually appears. `delay` staggers the pulse so three
 * skeletons read as a loading list rather than one flashing block.
 */
export const StaggeredRow = () => (
  <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
    <SkeletonCard delay={0} />
    <SkeletonCard delay={120} />
    <SkeletonCard delay={240} />
  </div>
);
