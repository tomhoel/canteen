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
import { getWeekId, getWeekIdOffset } from "../lib/dateUtils.js";
import * as realDishCache from "./services/dish-cache.service.js";

interface World {
  record: WeeklyMenuRecord | null;
  /** normalised dish name -> stored image path */
  images: Map<string, string>;
  cacheReadFails: boolean;
  dishesLookedUp: string[][];
}

let world: World;

function reset(overrides: Partial<World> = {}) {
  world = {
    record: null,
    images: new Map(),
    cacheReadFails: false,
    dishesLookedUp: [],
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
    scrapedAt: "2026-08-14T00:00:00.000Z",
  };
}

mock.module("./services/menu.service.js", {
  namedExports: {
    getWeeklyMenuService: async () => world.record,
    runWeeklyUpdateService: async () => {
      throw new Error("the read path must never run an update");
    },
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
