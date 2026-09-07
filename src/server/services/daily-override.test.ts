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
  const { overridden } = applyDailyOverride(data, board([item("Faktisk servert", true)]), "friday");

  assert.deepEqual(overridden, ["Flow"]);
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

  assert.deepEqual(applyDailyOverride(data, stray, "friday").overridden, []);
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
  assert.deepEqual(applyDailyOverride(data, board(undefined, undefined), "friday").overridden, []);
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

// ─── The rollover guard ───
//
// The daily board carries no date — it is "DAGENS LUNSJ" and three dishes — so
// a scrape that runs after the kitchen has rolled it forward writes tomorrow's
// food into today's slot. Both boards below are what Fresh4you actually
// published on 2026-09-07, eight hours apart, against that week's real weekly
// menu.

const WEEKLY_MON = [
  item("Stekt ris med egg og grønnsaker"),
  item("Norsk bondesuppe med urøkt pølse"),
  item("Ovnsbakt torskefilet med rattatouille og saltbakte poteter", true),
];
const WEEKLY_TUE = [
  item("Vegetar bratwurst med potetmos", true),
  // The kitchen typed English into the Norwegian column. Real noise, kept.
  item("Creamy cauliflower soup"),
  item("Buljong og krydder trukne wienerpølser, med potetmos, lomper og tilbehør"),
];

/** A Mon/Tue week for one canteen, so the guard has a tomorrow to compare to. */
const monTueWeek = (): MenuData => ({
  scrapedAt: "2026-09-07T06:00:00.000Z",
  canteens: {
    Fresh4you: {
      week: "Uke 37",
      openingHours: "10:30 - 13:00",
      menu: [
        { day: "Monday", no: { label: "MANDAG", items: WEEKLY_MON } },
        { day: "Tuesday", no: { label: "TIRSDAG", items: WEEKLY_TUE } },
      ],
    },
  },
});

const f4yBoard = (items: MenuItem[]): MenuData => ({
  scrapedAt: "2026-09-07T06:00:00.000Z",
  canteens: {
    Fresh4you: {
      week: "",
      openingHours: "",
      menu: [{ day: "Monday", no: { label: "DAGENS LUNSJ", items } }],
    },
  },
});

test("applyDailyOverride - applies a board that is showing today's food", () => {
  // Fresh4you's real board on Monday morning: the same dishes as the weekly
  // Monday, worded differently, which is exactly what the override is for.
  const data = monTueWeek();
  const morning = f4yBoard([
    item("Ovnsbakt torsk med ratatouille og saltbakte poteter", true),
    item("Stekt ris med egg, karri og grønnsaker"),
    item("Norsk bondesuppe med rotgrønnsaker og urøkt pølse"),
  ]);

  const { overridden, rolledOver } = applyDailyOverride(data, morning, "monday");

  assert.deepEqual(overridden, ["Fresh4you"]);
  assert.deepEqual(rolledOver, []);
  assert.equal(
    data.canteens.Fresh4you.menu[0].no?.items[0].dish,
    "Ovnsbakt torsk med ratatouille og saltbakte poteter"
  );
});

test("applyDailyOverride - refuses a board that has rolled over to tomorrow", () => {
  // The same board eight hours later, now showing Tuesday's food. Writing it
  // to Monday is worse than the stale weekly menu it would replace.
  const data = monTueWeek();
  const evening = f4yBoard([
    item("Vegetar bratwurst med potetmos", true),
    item("Kremet blomkålsuppe"),
    item("Buljong og krydder trukne wienerpølser med potetmos, potetlompe og tilbehør"),
  ]);

  const { overridden, rolledOver } = applyDailyOverride(data, evening, "monday");

  assert.deepEqual(overridden, []);
  assert.deepEqual(rolledOver, ["Fresh4you"]);
  assert.equal(
    data.canteens.Fresh4you.menu[0].no?.items[0].dish,
    "Stekt ris med egg og grønnsaker",
    "Monday must still hold Monday's weekly menu"
  );
});

test("applyDailyOverride - still applies a board that matches neither day", () => {
  // The case the override exists for: the weekly menu is a draft nobody cooked,
  // so the board matches nothing in it. The guard must not fire on a low score
  // alone — only on tomorrow scoring clearly HIGHER than today.
  const data = monTueWeek();
  const unrelated = f4yBoard([
    item("Lasagne med salat", true),
    item("Tomatsuppe"),
    item("Fiskegrateng med ertestuing"),
  ]);

  const { overridden, rolledOver } = applyDailyOverride(data, unrelated, "monday");

  assert.deepEqual(overridden, ["Fresh4you"]);
  assert.deepEqual(rolledOver, []);
});

test("applyDailyOverride - the guard cannot fire on Friday, and says so by behaviour", () => {
  // There is no next day inside the week, so a Friday board is always applied.
  // Documented in the code; asserted here so the limitation is visible rather
  // than discovered.
  const data = monTueWeek();
  data.canteens.Fresh4you.menu = [
    { day: "Friday", no: { label: "FREDAG", items: WEEKLY_MON } },
  ];
  const board = f4yBoard([item("Noe helt annet", true)]);

  const { overridden, rolledOver } = applyDailyOverride(data, board, "friday");

  assert.deepEqual(overridden, ["Fresh4you"]);
  assert.deepEqual(rolledOver, []);
});

test("applyDailyOverride - one canteen rolling over does not block the others", () => {
  const data = monTueWeek();
  data.canteens.Flow = {
    week: "Uke 37",
    openingHours: "10:30 - 13:00",
    menu: [
      { day: "Monday", no: { label: "MANDAG", items: [item("Flow mandag", true)] } },
      { day: "Tuesday", no: { label: "TIRSDAG", items: [item("Flow tirsdag", true)] } },
    ],
  };

  const boards: MenuData = {
    scrapedAt: "2026-09-07T16:00:00.000Z",
    canteens: {
      // rolled
      Fresh4you: f4yBoard([
        item("Vegetar bratwurst med potetmos", true),
        item("Kremet blomkålsuppe"),
        item("Buljong og krydder trukne wienerpølser med potetmos, potetlompe og tilbehør"),
      ]).canteens.Fresh4you,
      // not rolled
      Flow: {
        week: "",
        openingHours: "",
        menu: [{ day: "Monday", no: { label: "DAGENS LUNSJ", items: [item("Flow faktisk servert", true)] } }],
      },
    },
  };

  const { overridden, rolledOver } = applyDailyOverride(data, boards, "monday");

  assert.deepEqual(overridden, ["Flow"]);
  assert.deepEqual(rolledOver, ["Fresh4you"]);
});
