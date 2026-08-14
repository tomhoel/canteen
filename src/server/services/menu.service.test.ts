import test from "node:test";
import assert from "node:assert/strict";
import { groupCanteensByPublishedWeek } from "./menu.service";
import { weekIdForWeekNumber } from "../../lib/dateUtils";
import type { MenuData } from "../../lib/types";

/** Minimal MenuData carrying only what the grouping actually reads. */
function menuWith(weeks: Record<string, string>): MenuData {
  const canteens: MenuData["canteens"] = {};
  for (const [name, week] of Object.entries(weeks)) {
    canteens[name] = { week, openingHours: "", menu: [] } as MenuData["canteens"][string];
  }
  return { canteens } as MenuData;
}

test("groupCanteensByPublishedWeek - one week when every canteen agrees", () => {
  const groups = groupCanteensByPublishedWeek(
    menuWith({ Flow: "UKE/WEEK 33", Fresh4you: "UKE/WEEK 33" }),
    "2026-W33"
  );

  assert.equal(groups.size, 1);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(33))!).sort(), [
    "Flow",
    "Fresh4you",
  ]);
});

test("groupCanteensByPublishedWeek - splits the real Friday rollover", () => {
  // The exact labels observed on 2026-08-14: two kitchens had moved to week 34
  // while Flow was still publishing 33. Filing all three under the calendar
  // week is what wrote next week's food into this week's row.
  const groups = groupCanteensByPublishedWeek(
    menuWith({
      Flow: "Bygg / Building M - Uke/Week 33",
      Fresh4you: "Uke/week 34",
      "Eat the street": "Uke/week 34",
    }),
    "2026-W33"
  );

  assert.equal(groups.size, 2);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(33))!), ["Flow"]);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(34))!).sort(), [
    "Eat the street",
    "Fresh4you",
  ]);
});

test("groupCanteensByPublishedWeek - an unreadable label falls back, never drops", () => {
  const groups = groupCanteensByPublishedWeek(
    menuWith({ Flow: "Unknown", Fresh4you: "Uke/week 34" }),
    "2026-W33"
  );

  assert.deepEqual(Object.keys(groups.get("2026-W33")!), ["Flow"]);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(34))!), ["Fresh4you"]);

  // Whatever the split, every canteen must still be filed somewhere.
  const filed = [...groups.values()].flatMap((c) => Object.keys(c));
  assert.deepEqual(filed.sort(), ["Flow", "Fresh4you"]);
});

test("groupCanteensByPublishedWeek - no canteens yields no groups", () => {
  assert.equal(groupCanteensByPublishedWeek(menuWith({}), "2026-W33").size, 0);
});
