/**
 * Which stored image each card gets.
 *
 * The client used to build `<day>/<canteen>.png` itself. That slot carries no
 * week, so only one week's plates can exist at a time — which is why the
 * updater had to build plates for whichever week the app happened to be
 * rendering, and why any other week's cards showed the wrong food. The server
 * resolves the path now, because only it knows (via dish_cache) which dish a
 * stored plate actually depicts.
 *
 * Requires --experimental-test-module-mocks; see the `test` script.
 */
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import type { WeeklyMenuRecord, CanteenData, MenuItem } from "../lib/types.js";
// @ts-expect-error query string isolates real module from mock in Node 20
import { getWeekId, getWeekIdOffset } from "../lib/dateUtils.js?real";
// @ts-expect-error query string isolates real module from mock in Node 20
import * as realDateUtils from "../lib/dateUtils.js?real";
// @ts-expect-error query string isolates real module from mock in Node 20
import * as realDishCache from "./services/dish-cache.service.js?real";

interface World {
  record: WeeklyMenuRecord | null;
  /** normalised dish name -> stored image path */
  images: Map<string, string>;
  cacheReadFails: boolean;
  dishesLookedUp: string[][];
  /** Stored rows by week id. Consulted before `record`, so a test that cares
      which week was asked for can answer per week. */
  rowsByWeek: Map<string, WeeklyMenuRecord>;
  /** Every week id the read path requested, in order. `undefined` means the
      implicit "whatever we should be showing" request. */
  weeksRequested: Array<string | undefined>;
  /** Pretend today is a weekend in Oslo. */
  weekend: boolean;
}

let world: World;

function reset(overrides: Partial<World> = {}) {
  world = {
    record: null,
    images: new Map(),
    cacheReadFails: false,
    dishesLookedUp: [],
    rowsByWeek: new Map(),
    weeksRequested: [],
    weekend: false,
    ...overrides,
  };
}

reset();

const THIS_WEEK = getWeekId();
const NEXT_WEEK = getWeekIdOffset(1);

function item(dish: string): MenuItem {
  return { dish, isMain: false, allergens: [] };
}

function canteen(dishesByDay: Record<string, string[]>): CanteenData {
  return {
    week: "Uke/Week 1",
    openingHours: "",
    menu: Object.entries(dishesByDay).map(([day, dishes]) => ({
      day,
      no: { label: day.toUpperCase(), items: dishes.map(item) },
    })),
  } as CanteenData;
}

function record(weekId: string, canteens: Record<string, CanteenData>): WeeklyMenuRecord {
  return {
    weekId,
    menuData: { scrapedAt: "2026-08-14T00:00:00.000Z", canteens } as any,
    dishOrigins: {},
    dishDescriptions: {},
    dishShortNames: {},
    scrapedAt: "2026-08-14T00:00:00.000Z",
  };
}

mock.module("./services/menu.service.js", {
  namedExports: {
    getWeeklyMenuService: async (weekId?: string) => {
      world.weeksRequested.push(weekId);
      if (world.rowsByWeek.size > 0) {
        // An implicit request means the current week, the same as the real
        // service resolves it.
        return world.rowsByWeek.get(weekId ?? THIS_WEEK) ?? null;
      }
      return world.record;
    },
    runWeeklyUpdateService: async () => {
      throw new Error("the read path must never run an update");
    },
  },
});

// isOsloWeekend is the only thing standing between a weekday and a weekend
// here, and the alternative to steering it is a test that passes on Tuesday
// and fails on Saturday.
mock.module("../lib/dateUtils.js", {
  namedExports: {
    ...realDateUtils,
    isOsloWeekend: () => world.weekend,
  },
});

mock.module("./services/dish-cache.service.js", {
  namedExports: {
    ...realDishCache,
    loadDishCache: async (dishes: string[]) => {
      world.dishesLookedUp.push([...dishes]);
      if (world.cacheReadFails) return { rows: new Map(), failed: true };
      const rows = new Map();
      for (const dish of dishes) {
        const key = realDishCache.normalizeDishName(dish);
        const path = world.images.get(key);
        if (path) rows.set(key, { cacheKey: key, imageNoBgPath: path });
      }
      return { rows, failed: false };
    },
  },
});

const { getWeeklyMenu, MenuUnavailableError } = await import("./menu.js");

/** Monday's first dish for a canteen — enough to tell two weeks apart. */
function mondayDish(menu: { menuData: { canteens: Record<string, CanteenData> } }, canteenName: string) {
  return menu.menuData.canteens[canteenName]?.menu[0]?.no?.items[0]?.dish;
}

test("a plate that dish_cache can address is served by dish, not by weekday slot", async () => {
  reset({ record: record(THIS_WEEK, { Flow: canteen({ Monday: ["Fiskesuppe"] }) }) });
  world.images.set("fiskesuppe", "archive/fiskesuppe.png");

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], "archive/fiskesuppe.png");
});

test("the calendar week still falls back to its weekday slot", async () => {
  // Not every plate has its path recorded yet — 8 of 29 stored main dishes did
  // not when this shipped — and for the week the app is actually rendering the
  // slot does hold the right food. Losing those would be a straight regression.
  reset({ record: record(THIS_WEEK, { Flow: canteen({ Monday: ["Ukjent rett"] }) }) });

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], "monday/flow.png");
});

test("any other week gets no picture rather than the wrong one", async () => {
  // The slot holds the calendar week's food. Showing it under next week's dish
  // name is the photo/dish mismatch this whole scheme exists to end.
  reset({ record: record(NEXT_WEEK, { Flow: canteen({ Monday: ["Ukjent rett"] }) }) });

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], undefined);
});

test("a future week still gets the plates it can address", async () => {
  reset({ record: record(NEXT_WEEK, { Flow: canteen({ Monday: ["Fiskesuppe"] }) }) });
  world.images.set("fiskesuppe", "archive/fiskesuppe.png");

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], "archive/fiskesuppe.png");
});

test("the image follows the ranked main dish, not the first line on the menu", async () => {
  // The card titles itself with the same ranking. If this used items[0] the
  // picture and the name would come from different dishes.
  reset({
    record: record(THIS_WEEK, {
      Flow: canteen({ Monday: ["Tomatsuppe", "Kylling med ris", "Couscous"] }),
    }),
  });
  world.images.set("kylling med ris", "archive/kylling-med-ris.png");
  world.images.set("tomatsuppe", "archive/tomatsuppe.png");

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], "archive/kylling-med-ris.png");
});

test("an unreadable dish_cache falls back to slots rather than blanking every card", async () => {
  reset({
    record: record(THIS_WEEK, { Flow: canteen({ Monday: ["Fiskesuppe"] }) }),
    cacheReadFails: true,
  });

  const menu = await getWeeklyMenu();

  assert.equal(menu.plateImages["monday|Flow"], "monday/flow.png");
});

test("keys cover every canteen and weekday, and nothing else", async () => {
  reset({
    record: record(THIS_WEEK, {
      Flow: canteen({ Monday: ["A"], Friday: ["B"] }),
      "Eat the street": canteen({ Monday: ["C"], Saturday: ["D"] }),
    }),
  });

  const menu = await getWeeklyMenu();

  assert.deepEqual(Object.keys(menu.plateImages).sort(), [
    "friday|Flow",
    "monday|Eat the street",
    "monday|Flow",
  ]);
  assert.equal(menu.plateImages["monday|Eat the street"], "monday/eat_the_street.png");
});

test("a day with no dishes contributes no key", async () => {
  reset({ record: record(THIS_WEEK, { Flow: canteen({ Monday: [] }) }) });

  const menu = await getWeeklyMenu();

  assert.deepEqual(menu.plateImages, {});
  assert.deepEqual(world.dishesLookedUp, [], "and costs no dish_cache read");
});

test("no stored menu at all is still an error, not an empty week", async () => {
  reset({ record: null });

  await assert.rejects(getWeeklyMenu(), MenuUnavailableError);
});

// ── Which week a weekend gets ─────────────────────────────────────────────

test("from Saturday the app is served next week, not the one that just ended", async () => {
  // The regression this covers: every row holds canteens labelled with its own
  // week, so a weekend request for *this* week can only ever put the client in
  // weekend-recap. allCanteensAhead needs next week's labels to be in the
  // payload at all, and only the read path can put them there.
  reset({ weekend: true });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Gammel rett"] }) }));
  world.rowsByWeek.set(NEXT_WEEK, record(NEXT_WEEK, { Flow: canteen({ Monday: ["Ny rett"] }) }));

  const menu = await getWeeklyMenu();

  assert.equal(mondayDish(menu, "Flow"),"Ny rett");
  assert.equal(world.weeksRequested[0], NEXT_WEEK, "next week is asked for first");
});

test("a weekday is never given next week", async () => {
  reset({ weekend: false });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Dagens rett"] }) }));
  world.rowsByWeek.set(NEXT_WEEK, record(NEXT_WEEK, { Flow: canteen({ Monday: ["Ny rett"] }) }));

  const menu = await getWeeklyMenu();

  assert.equal(mondayDish(menu, "Flow"),"Dagens rett");
  assert.ok(!world.weeksRequested.includes(NEXT_WEEK), "next week is not even looked at");
});

test("a weekend before the kitchens have published falls back to the week that just ended", async () => {
  // Better a recap of Friday than an empty app. This is the common case on a
  // Saturday morning — the kitchens publish at their own pace.
  reset({ weekend: true });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Gammel rett"] }) }));

  const menu = await getWeeklyMenu();

  assert.equal(mondayDish(menu, "Flow"),"Gammel rett");
});

test("an empty next-week row does not count as published", async () => {
  // A row can exist with no canteens in it. Serving that is a blank app, which
  // is strictly worse than last week's food.
  reset({ weekend: true });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Gammel rett"] }) }));
  world.rowsByWeek.set(NEXT_WEEK, record(NEXT_WEEK, {}));

  const menu = await getWeeklyMenu();

  assert.equal(mondayDish(menu, "Flow"),"Gammel rett");
});

test("one canteen having published is enough to preview", async () => {
  // Flow habitually rolls over a day or two after the others. Waiting for the
  // slowest kitchen would mean the preview rarely appeared on a Saturday at
  // all, which is the day it was asked for. The absent canteens are named in
  // the banner instead.
  reset({ weekend: true });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Gammel rett"] }) }));
  world.rowsByWeek.set(NEXT_WEEK, record(NEXT_WEEK, { Fresh4you: canteen({ Monday: ["Ny rett"] }) }));

  const menu = await getWeeklyMenu();

  assert.deepEqual(Object.keys(menu.menuData.canteens), ["Fresh4you"]);
});

test("an explicitly requested week is never second-guessed, weekend or not", async () => {
  reset({ weekend: true });
  world.rowsByWeek.set(THIS_WEEK, record(THIS_WEEK, { Flow: canteen({ Monday: ["Gammel rett"] }) }));
  world.rowsByWeek.set(NEXT_WEEK, record(NEXT_WEEK, { Flow: canteen({ Monday: ["Ny rett"] }) }));

  const menu = await getWeeklyMenu(THIS_WEEK);

  assert.equal(mondayDish(menu, "Flow"),"Gammel rett");
  assert.deepEqual(world.weeksRequested, [THIS_WEEK], "asked once, for exactly what was requested");
});
