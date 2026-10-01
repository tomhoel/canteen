import test from "node:test";
import assert from "node:assert/strict";
import { rerankMenu } from "./course.service";
import type { MenuData, MenuItem } from "../../lib/types";

const it = (dish: string, isMain = false): MenuItem => ({ dish, isMain, allergens: [] });

function week(items: MenuItem[]): MenuData {
  return {
    scrapedAt: "",
    canteens: {
      Flow: { week: "40", openingHours: "", menu: [{ day: "thursday", no: { label: "", items } }] },
    },
  };
}

test("rerankMenu overrides the scraper's pick with the labels and stores it first", () => {
  // The scraper left the porridge first and flagged; the labels say the fish is the main.
  const data = week([it("Havregrøt med tomater", true), it("Stekt sei med erter"), it("Maissuppe")]);
  const changed = rerankMenu(data, { "Havregrøt med tomater": "veg", "Stekt sei med erter": "meat_plate", Maissuppe: "soup" });
  const items = data.canteens.Flow.menu[0].no!.items;
  assert.deepEqual(items.map((i) => i.dish), ["Stekt sei med erter", "Havregrøt med tomater", "Maissuppe"]);
  assert.deepEqual(items.map((i) => i.isMain), [true, false, false]);
  assert.equal(changed, 1);
});

test("rerankMenu with no labels falls back to the name rules and reports no change when the winner holds", () => {
  const data = week([it("Kyllingbryst med ris", true), it("Tomatsuppe")]);
  assert.equal(rerankMenu(data, {}), 0);
  assert.equal(data.canteens.Flow.menu[0].no!.items[0].dish, "Kyllingbryst med ris");
});

test("rerankMenu matches labels by trimmed name", () => {
  const data = week([it("Grøt", true), it("Stekt sei ")]);
  rerankMenu(data, { "Stekt sei": "meat_plate", Grøt: "veg" });
  assert.equal(data.canteens.Flow.menu[0].no!.items[0].dish, "Stekt sei ");
});
