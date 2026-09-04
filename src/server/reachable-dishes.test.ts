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
 *   const noMainDish   = noRanked.find(i => i.isMain && i.dish.trim());
 *   const lookupMainDish = noMainDish ?? getRankedItems(enLookup, canteen).find(i => i.isMain);
 *   dishDescriptions[lookupMainDish?.dish || ""]
 *
 * so whatever that expression can produce must survive the trim.
 */

const item = (dish: string): MenuItem => ({ dish, isMain: false, allergens: [] });

/** The client's lookup key for one canteen-day, transcribed from HomeClient. */
function clientLookupKey(
  no: MenuItem[] | undefined,
  en: MenuItem[] | undefined,
  canteenName: string
): string | undefined {
  const noMain = rankItems(no, canteenName).find((i) => i.isMain && i.dish.trim());
  const lookup = noMain ?? rankItems(en, canteenName).find((i) => i.isMain);
  return lookup?.dish;
}

const week = (no?: MenuItem[], en?: MenuItem[]): MenuData => ({
  scrapedAt: "2026-09-04T06:00:00.000Z",
  canteens: {
    Flow: {
      week: "Uke 36",
      openingHours: "10:30 - 13:00",
      menu: [{ day: "Friday", ...(no ? { no: { label: "FREDAG", items: no } } : {}), ...(en ? { en: { label: "FRIDAY", items: en } } : {}) }],
    },
  },
});

/** Mirrors the server helper, so the two can be compared without exporting it. */
function serverKeys(data: MenuData): Set<string> {
  const names = new Set<string>();
  for (const [canteenName, canteen] of Object.entries(data.canteens)) {
    for (const day of canteen.menu) {
      for (const items of [day.no?.items, day.en?.items]) {
        const main = rankItems(items, canteenName)[0]?.dish?.trim();
        if (main) names.add(main);
      }
    }
  }
  return names;
}

test("the trimmed key set contains whatever the card will ask for", () => {
  const cases: Array<[MenuItem[] | undefined, MenuItem[] | undefined]> = [
    [[item("Ovnsbakt torsk"), item("Suppe")], [item("Oven baked cod"), item("Soup")]],
    [[item("Kyllinggryte")], undefined],
    [undefined, [item("Chicken stew")]],
  ];

  for (const [no, en] of cases) {
    const wanted = clientLookupKey(no, en, "Flow");
    const shipped = serverKeys(week(no, en));
    assert.ok(
      wanted === undefined || shipped.has(wanted),
      `card would look up ${JSON.stringify(wanted)}, which the trim drops`
    );
  }
});

test("a blank Norwegian main falls through to the English one, on both sides", () => {
  // The case that makes the plate-image key set the WRONG thing to reuse:
  // resolvePlateImages skips this day entirely, while the card falls through
  // to the English main and still wants its description.
  const no = [item("   ")];
  const en = [item("Oven baked cod with ratatouille")];

  assert.equal(clientLookupKey(no, en, "Flow"), "Oven baked cod with ratatouille");
  assert.ok(serverKeys(week(no, en)).has("Oven baked cod with ratatouille"));
});

test("side dishes are never shipped — they are never looked up", () => {
  const no = [item("Ovnsbakt torsk"), item("Kikertsuppe"), item("Pad Thai")];
  const shipped = serverKeys(week(no, undefined));

  assert.equal(shipped.size, 1, `expected only the main, got ${[...shipped].join(", ")}`);
  assert.ok(!shipped.has("Kikertsuppe"));
  assert.ok(!shipped.has("Pad Thai"));
});

test("an empty week ships nothing rather than everything", () => {
  assert.equal(serverKeys(week(undefined, undefined)).size, 0);
  assert.equal(serverKeys({ scrapedAt: "", canteens: {} }).size, 0);
});
