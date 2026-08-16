import test from "node:test";
import assert from "node:assert/strict";
import { groupCanteensByPublishedWeek, mergeCanteensForWeek } from "./menu.service";
import { getWeekId, getWeekIdOffset, weekIdForWeekNumber } from "../../lib/dateUtils";
import type { MenuData } from "../../lib/types";

/**
 * Week numbers taken from the calendar rather than written down.
 *
 * These tests were originally pinned to the real 2026-W33/W34 rollover, which
 * was fine while grouping was a pure function of the label. It is not any more:
 * routing now rejects a week more than two off the calendar week, so hardcoded
 * "33"/"34" labels would have started failing three weeks after they were
 * written and never recovered — which is exactly the kind of slow rot the new
 * CI job exists to catch, so it must not be the thing CI trips over.
 */
const THIS_WEEK = Number(getWeekId().slice(-2));
const NEXT_WEEK = Number(getWeekIdOffset(1).slice(-2));

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
    menuWith({ Flow: `UKE/WEEK ${THIS_WEEK}`, Fresh4you: `UKE/WEEK ${THIS_WEEK}` }),
    getWeekId()
  );

  assert.equal(groups.size, 1);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(THIS_WEEK))!).sort(), [
    "Flow",
    "Fresh4you",
  ]);
});

test("groupCanteensByPublishedWeek - splits the real Friday rollover", () => {
  // The shape observed on Friday 2026-08-14: two kitchens had moved to next
  // week while Flow was still publishing this one. Filing all three under the
  // calendar week is what wrote next week's food into this week's row.
  const groups = groupCanteensByPublishedWeek(
    menuWith({
      Flow: `Bygg / Building M - Uke/Week ${THIS_WEEK}`,
      Fresh4you: `Uke/week ${NEXT_WEEK}`,
      "Eat the street": `Uke/week ${NEXT_WEEK}`,
    }),
    getWeekId()
  );

  assert.equal(groups.size, 2);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(THIS_WEEK))!), ["Flow"]);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(NEXT_WEEK))!).sort(), [
    "Eat the street",
    "Fresh4you",
  ]);
});

test("groupCanteensByPublishedWeek - an unreadable label falls back, never drops", () => {
  const groups = groupCanteensByPublishedWeek(
    menuWith({ Flow: "Unknown", Fresh4you: `Uke/week ${NEXT_WEEK}` }),
    getWeekId()
  );

  assert.deepEqual(Object.keys(groups.get(getWeekId())!), ["Flow"]);
  assert.deepEqual(Object.keys(groups.get(weekIdForWeekNumber(NEXT_WEEK))!), ["Fresh4you"]);

  // Whatever the split, every canteen must still be filed somewhere.
  const filed = [...groups.values()].flatMap((c) => Object.keys(c));
  assert.deepEqual(filed.sort(), ["Flow", "Fresh4you"]);
});

test("groupCanteensByPublishedWeek - a week nowhere near the calendar is not trusted", () => {
  // "Bygg 39" in August parses as week 39 with nothing to anchor it, and would
  // otherwise mint a permanent row key nothing ever reads. Half a year out is
  // the furthest anything can be, so this holds in every week of the year.
  const implausible = ((THIS_WEEK + 25) % 52) + 1;
  const groups = groupCanteensByPublishedWeek(
    menuWith({ Flow: `Bygg ${implausible}`, Fresh4you: `Uke/week ${THIS_WEEK}` }),
    getWeekId()
  );

  assert.equal(groups.size, 1);
  assert.deepEqual(Object.keys(groups.get(getWeekId())!).sort(), ["Flow", "Fresh4you"]);
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
