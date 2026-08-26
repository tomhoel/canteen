import test from "node:test";
import assert from "node:assert/strict";
import { validateTitleCorrection } from "./ai.service.js";
import { extractNoDishes, applyTitleCorrections } from "./menu.service.js";
import type { MenuData, CanteenData } from "../../lib/types.js";

// ─── validateTitleCorrection Heuristics ───────────────────────────────────────

test("validateTitleCorrection - accepts valid compound-word join", () => {
  assert.equal(validateTitleCorrection("Tomat suppe", "Tomatsuppe"), true);
  assert.equal(validateTitleCorrection("Blomkål suppe", "Blomkålsuppe"), true);
  assert.equal(validateTitleCorrection("Karri saus", "Karrisaus"), true);
  assert.equal(validateTitleCorrection("Pasta grateng", "Pastagrateng"), true);
  assert.equal(validateTitleCorrection("Sitron potet", "Sitronpotet"), true);
});

test("validateTitleCorrection - accepts small typo fix", () => {
  assert.equal(validateTitleCorrection("Kyllling med ris", "Kylling med ris"), true);
  assert.equal(validateTitleCorrection("Grgrønnsaker", "Grønnsaker"), true);
  assert.equal(validateTitleCorrection("Ppork", "Pork"), true);
  assert.equal(validateTitleCorrection("Pasta grateng med grgrønnsaker", "Pasta grateng med grønnsaker"), true);
  assert.equal(validateTitleCorrection("Pasta grateng med grgrønnsaker", "Pastagrateng med grønnsaker"), true);
});

test("validateTitleCorrection - accepts capitalization fix", () => {
  assert.equal(validateTitleCorrection("Bbq kylling", "BBQ kylling"), true);
});

test("validateTitleCorrection - rejects no-op or blank corrections", () => {
  assert.equal(validateTitleCorrection("Kylling med ris", "Kylling med ris"), false);
  assert.equal(validateTitleCorrection("Kylling med ris", "   "), false);
  assert.equal(validateTitleCorrection("Kylling med ris", ""), false);
});

test("validateTitleCorrection - rejects translation from Norwegian to English", () => {
  assert.equal(
    validateTitleCorrection("Svensk kjøttgrateng med hvitløkspoteter", "Swedish meat gratin with garlic potatoes"),
    false
  );
  assert.equal(
    validateTitleCorrection("Rødspette med råkost", "Plaice with raw vegetables"),
    false
  );
});

test("validateTitleCorrection - rejects wholesale rewrites", () => {
  assert.equal(
    validateTitleCorrection("Kyllingsuppe med brød", "Biff med bearnaisesaus"),
    false
  );
  assert.equal(
    validateTitleCorrection("Dagens fisk", "Vegetarisk linsegryte"),
    false
  );
});

// ─── extractNoDishes & applyTitleCorrections ──────────────────────────────────

test("extractNoDishes - extracts unique Norwegian dish names", () => {
  const menuData: MenuData = {
    scrapedAt: "2026-08-26T00:00:00.000Z",
    canteens: {
      Flow: {
        week: "Uke 35",
        openingHours: "11:00 - 13:00",
        menu: [
          {
            day: "Monday",
            no: {
              label: "MANDAG",
              items: [
                { dish: "Pasta grateng med grgrønnsaker", isMain: true, allergens: [] },
                { dish: "Klar kyllingsuppe", isMain: false, allergens: [] },
              ],
            },
            en: {
              label: "MONDAY",
              items: [
                { dish: "Pasta gratin with vegetables", isMain: true, allergens: [] },
              ],
            },
          },
        ],
      } as CanteenData,
    },
  };

  const noDishes = extractNoDishes(menuData);
  assert.deepEqual(noDishes.sort(), [
    "Klar kyllingsuppe",
    "Pasta grateng med grgrønnsaker",
  ].sort());
});

test("applyTitleCorrections - updates matching Norwegian dishes and leaves English untouched", () => {
  const menuData: MenuData = {
    scrapedAt: "2026-08-26T00:00:00.000Z",
    canteens: {
      Flow: {
        week: "Uke 35",
        openingHours: "11:00 - 13:00",
        menu: [
          {
            day: "Monday",
            no: {
              label: "MANDAG",
              items: [
                { dish: "Pasta grateng med grgrønnsaker", isMain: true, allergens: [] },
                { dish: "Klar kyllingsuppe", isMain: false, allergens: [] },
              ],
            },
            en: {
              label: "MONDAY",
              items: [
                { dish: "Pasta grateng with vegetable", isMain: true, allergens: [] },
              ],
            },
          },
        ],
      } as CanteenData,
    },
  };

  const count = applyTitleCorrections(menuData, {
    "Pasta grateng med grgrønnsaker": "Pastagrateng med grønnsaker",
  });

  assert.equal(count, 1);
  assert.equal(menuData.canteens.Flow.menu[0].no!.items[0].dish, "Pastagrateng med grønnsaker");
  assert.equal(menuData.canteens.Flow.menu[0].no!.items[1].dish, "Klar kyllingsuppe");
  // English dish is unchanged
  assert.equal(menuData.canteens.Flow.menu[0].en!.items[0].dish, "Pasta grateng with vegetable");
});
