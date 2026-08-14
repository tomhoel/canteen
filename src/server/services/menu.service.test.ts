import test from "node:test";
import assert from "node:assert/strict";
import { groupCanteensByPublishedWeek, mergeCanteensForWeek } from "./menu.service";
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

/** A canteen entry reduced to the fields the merge actually distinguishes. */
const c = (week: string) => ({ week, openingHours: "", menu: [] }) as MenuData["canteens"][string];

test("mergeCanteensForWeek - this week's scrape wins over what is stored", () => {
  const merged = mergeCanteensForWeek(
    { Flow: c("Uke 32") },
    { Flow: c("Uke 33") },
    { Flow: c("Uke 33") }
  );
  assert.equal(merged.Flow.week, "Uke 33");
});

test("mergeCanteensForWeek - keeps stored canteens this scrape did not route here", () => {
  // The Friday case: only Flow published week 33, but the row already holds all
  // three. Replacing instead of merging would delete two canteens' menus from a
  // week whose upstream pages are already gone.
  const merged = mergeCanteensForWeek(
    { Flow: c("Uke 33"), Fresh4you: c("Uke 33"), "Eat the street": c("Uke 33") },
    { Flow: c("Uke 33"), Fresh4you: c("Uke 34"), "Eat the street": c("Uke 34") },
    { Flow: c("Uke 33") }
  );

  assert.deepEqual(Object.keys(merged).sort(), ["Eat the street", "Flow", "Fresh4you"]);
  assert.equal(merged.Fresh4you.week, "Uke 33", "stored week-33 entry must survive");
  assert.equal(merged["Eat the street"].week, "Uke 33");
});

test("mergeCanteensForWeek - seeds a laggard into a brand-new week's row", () => {
  // Next week's row is created by the two kitchens that rolled over. Flow has
  // not, so without seeding it would be missing entirely once week 34 arrives.
  const merged = mergeCanteensForWeek(
    undefined,
    { Flow: c("Uke 33"), Fresh4you: c("Uke 34"), "Eat the street": c("Uke 34") },
    { Fresh4you: c("Uke 34"), "Eat the street": c("Uke 34") }
  );

  assert.deepEqual(Object.keys(merged).sort(), ["Eat the street", "Flow", "Fresh4you"]);
  // Seeded with its own stale label so the UI can mark the card outdated.
  assert.equal(merged.Flow.week, "Uke 33");
});

test("mergeCanteensForWeek - a seed never overwrites what is already stored", () => {
  const merged = mergeCanteensForWeek(
    { Flow: c("Uke 34") },
    { Flow: c("Uke 33") },
    {}
  );
  assert.equal(merged.Flow.week, "Uke 34", "stored entry outranks a cross-week seed");
});
