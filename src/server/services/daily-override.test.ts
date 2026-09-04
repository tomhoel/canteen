import test from "node:test";
import assert from "node:assert/strict";
import { applyDailyOverride, buildDailyMenuData } from "./menu.service.js";
import type { MenuData, MenuItem } from "../../lib/types.js";

const item = (dish: string, isMain = false): MenuItem => ({ dish, isMain, allergens: [] });

/** A week where every canteen published all five days. */
const week = (): MenuData => ({
  scrapedAt: "2026-09-01T06:00:00.000Z",
  canteens: {
    Flow: {
      week: "Uke 36",
      openingHours: "10:30 - 13:00",
      menu: [
        { day: "Thursday", no: { label: "TORSDAG", items: [item("Torsdagsgryte", true)] } },
        {
          day: "Friday",
          no: { label: "FREDAG", items: [item("Planlagt fredagsrett", true)] },
          en: { label: "FRIDAY", items: [item("Planned Friday dish", true)] },
        },
      ],
    },
  },
});

const board = (no?: MenuItem[], en?: MenuItem[]): MenuData => ({
  scrapedAt: "2026-09-04T06:00:00.000Z",
  canteens: {
    Flow: {
      week: "",
      openingHours: "10:30 - 13:00",
      menu: [
        {
          day: "Friday",
          ...(no ? { no: { label: "FREDAG", items: no } } : {}),
          ...(en ? { en: { label: "FRIDAY", items: en } } : {}),
        },
      ],
    },
  },
});

const dayOf = (data: MenuData, canteen: string, day: string) =>
  data.canteens[canteen].menu.find((d) => d.day.toLowerCase() === day);

test("applyDailyOverride - replaces today's dishes with the board's", () => {
  const data = week();
  const changed = applyDailyOverride(data, board([item("Faktisk servert", true)]), "friday");

  assert.deepEqual(changed, ["Flow"]);
  assert.deepEqual(
    dayOf(data, "Flow", "friday")?.no?.items.map((i) => i.dish),
    ["Faktisk servert"]
  );
});

test("applyDailyOverride - leaves every other day untouched", () => {
  const data = week();
  applyDailyOverride(data, board([item("Faktisk servert", true)]), "friday");

  assert.deepEqual(
    dayOf(data, "Flow", "thursday")?.no?.items.map((i) => i.dish),
    ["Torsdagsgryte"]
  );
});

test("applyDailyOverride - a language the board skipped keeps the weekly menu", () => {
  // The kitchen fills in the Norwegian column first and sometimes never gets
  // to the English one. Blanking it would be worse than a stale translation.
  const data = week();
  applyDailyOverride(data, board([item("Faktisk servert", true)], undefined), "friday");

  const friday = dayOf(data, "Flow", "friday");
  assert.deepEqual(friday?.no?.items.map((i) => i.dish), ["Faktisk servert"]);
  assert.deepEqual(friday?.en?.items.map((i) => i.dish), ["Planned Friday dish"]);
});

test("applyDailyOverride - never introduces a canteen the week does not have", () => {
  // One day of food is not enough to add a canteen: the card would show today
  // and four blanks.
  const data = week();
  const stray = board([item("Ukjent kantine", true)]);
  stray.canteens["Ghost Kitchen"] = stray.canteens.Flow;
  delete (stray.canteens as Record<string, unknown>).Flow;

  assert.deepEqual(applyDailyOverride(data, stray, "friday"), []);
  assert.deepEqual(Object.keys(data.canteens), ["Flow"]);
});

test("applyDailyOverride - adds today when the weekly widget skipped it", () => {
  // A kitchen that rolled over mid-week leaves the current week with no entry
  // for today at all.
  const data = week();
  data.canteens.Flow.menu = data.canteens.Flow.menu.filter((d) => d.day !== "Friday");

  applyDailyOverride(data, board([item("Faktisk servert", true)]), "friday");

  assert.deepEqual(
    data.canteens.Flow.menu.map((d) => d.day),
    ["Thursday", "Friday"],
    "the new day must land in Monday-to-Friday order"
  );
});

test("applyDailyOverride - does not mutate the object it read from", () => {
  // The CanteenData objects are shared with the raw scrape, which the write
  // loop reuses for every other week in the run. An in-place edit here would
  // leak today's dishes into next week's row.
  const data = week();
  const shared = data.canteens.Flow;
  const sharedMenuLength = shared.menu.length;
  const sharedFriday = shared.menu.find((d) => d.day === "Friday");

  applyDailyOverride(data, board([item("Faktisk servert", true)]), "friday");

  assert.equal(shared.menu.length, sharedMenuLength);
  assert.deepEqual(sharedFriday?.no?.items.map((i) => i.dish), ["Planlagt fredagsrett"]);
  assert.notEqual(data.canteens.Flow, shared, "the canteen entry should be replaced, not edited");
});

test("applyDailyOverride - an empty board changes nothing", () => {
  const data = week();
  const before = JSON.stringify(data);
  assert.deepEqual(applyDailyOverride(data, board(undefined, undefined), "friday"), []);
  assert.equal(JSON.stringify(data), before);
});

test("buildDailyMenuData - shapes the boards as a one-day MenuData", () => {
  const built = buildDailyMenuData(
    [
      {
        canteen: {
          name: "Bygg M",
          token: "w",
          dailyToken: "d",
          hours: "10:30 - 13:00",
          displayName: "Flow",
        },
        daily: { no: { label: "FREDAG", items: [item("Dagens", true)] } },
        error: null,
      },
      {
        canteen: {
          name: "The Hub",
          token: "w2",
          dailyToken: "d2",
          hours: "10:30 - 14:00",
          displayName: "Eat the street",
        },
        daily: null,
        error: "HTTP 500",
      },
    ],
    "friday"
  );

  assert.deepEqual(Object.keys(built.canteens), ["Flow"], "a failed board contributes nothing");
  assert.equal(built.canteens.Flow.menu[0].day, "Friday");
  // No week label: inventing one would feed groupCanteensByPublishedWeek a
  // number the kitchen never published.
  assert.equal(built.canteens.Flow.week, "");
});
