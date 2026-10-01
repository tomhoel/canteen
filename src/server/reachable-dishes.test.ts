import test from "node:test";
import assert from "node:assert/strict";
import { rankItems } from "../lib/dish-ranking.js";
import type { MenuData, MenuItem } from "../lib/types.js";

/**
 * `/api/menu` no longer ships enrichment for every dish it stores, only for the
 * ones a card can look up. That is a correctness risk, not just a size one: if
 * the server's idea of "reachable" ever drifts from the client's, a dish
 * quietly loses its description and its flag with nothing failing.
 *
 * These tests pin the rule from the client's side. HomeClient does:
 *
 *   const items = getRankedItems(dayEntry?.no?.items, canteenName);
 *   const mainDish = items.find(i => i.isMain && i.dish.trim());
 *   dishDescriptions[mainDish?.dish || ""]
 *
 * so whatever that expression can produce must survive the trim.
 */

const item = (dish: string): MenuItem => ({ dish, isMain: false, allergens: [] });

/** The client's lookup key for one canteen-day, transcribed from HomeClient. */
function clientLookupKey(no: MenuItem[] | undefined, canteenName: string): string | undefined {
  return rankItems(no, canteenName).find((i) => i.isMain && i.dish.trim())?.dish;
}

const week = (no?: MenuItem[]): MenuData => ({
  scrapedAt: "2026-09-04T06:00:00.000Z",
  canteens: {
    Flow: {
      week: "Uke 36",
      openingHours: "10:30 - 13:00",
      menu: [{ day: "Friday", ...(no ? { no: { label: "FREDAG", items: no } } : {}) }],
    },
  },
});

/** Mirrors the server helper, so the two can be compared without exporting it. */
function serverKeys(data: MenuData): Set<string> {
  const names = new Set<string>();
  for (const [canteenName, canteen] of Object.entries(data.canteens)) {
    for (const day of canteen.menu) {
      const main = rankItems(day.no?.items, canteenName)[0]?.dish?.trim();
      if (main) names.add(main);
    }
  }
  return names;
}

test("the trimmed key set contains whatever the card will ask for", () => {
  const cases: Array<MenuItem[] | undefined> = [
    [item("Ovnsbakt torsk"), item("Suppe")],
    [item("Kyllinggryte")],
    undefined,
  ];

  for (const no of cases) {
    const wanted = clientLookupKey(no, "Flow");
    const shipped = serverKeys(week(no));
    assert.ok(
      wanted === undefined || shipped.has(wanted),
      `card would look up ${JSON.stringify(wanted)}, which the trim drops`
    );
  }
});

test("side dishes are never shipped — they are never looked up", () => {
  const no = [item("Ovnsbakt torsk"), item("Kikertsuppe"), item("Pad Thai")];
  const shipped = serverKeys(week(no));

  assert.equal(shipped.size, 1, `expected only the main, got ${[...shipped].join(", ")}`);
  assert.ok(!shipped.has("Kikertsuppe"));
  assert.ok(!shipped.has("Pad Thai"));
});

test("an empty week ships nothing rather than everything", () => {
  assert.equal(serverKeys(week(undefined)).size, 0);
  assert.equal(serverKeys({ scrapedAt: "", canteens: {} }).size, 0);
});
