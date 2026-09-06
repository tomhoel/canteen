import { ClosedCanteensPill } from "canteen";

/*
  A status pill that names which kitchens are shut. It renders nothing at all
  for an empty list, which is why the empty case is not a story — there would
  be no cell to look at.
*/

const canteen = (canteenName: string) => ({
  canteenName,
  canteen: { week: "Uke/week 37", openingHours: "10:30 - 13:00" },
});

/** One closed canteen — the label is singular. */
export const One = () => (
  <ClosedCanteensPill closedCanteens={[canteen("Kantine M")]} />
);

/** Two or more — the label pluralises to "kantiner stengt". */
export const Several = () => (
  <ClosedCanteensPill closedCanteens={[canteen("Kantine M"), canteen("Fresh4you")]} />
);
