import test from "node:test";
import assert from "node:assert/strict";
import { scoreMainDish, rankItems, pickMainDish } from "./dish-ranking";
import type { MenuItem } from "./types";

const item = (dish: string): MenuItem => ({ dish, isMain: false, allergens: [] });

test("pizza is never the main dish at Eat the street", () => {
  assert.equal(scoreMainDish("Pizza med skinke og ost", "Eat the street"), -100);
  assert.ok(
    scoreMainDish("Pizza med skinke og ost", "Eat the street") <
      scoreMainDish("Provence suppe", "Eat the street")
  );
});

test("soups rank below a centrepiece protein", () => {
  assert.ok(
    scoreMainDish("Kremet fiskesuppe", "Flow") <
      scoreMainDish("Tandoori kylling med ris", "Flow")
  );
});

test("lamb outranks a vegetarian wok", () => {
  // Regression: 'lam'/'lamb' was absent from the centrepiece list, so
  // "Wok med nudler og grønnsaker" was picked over "Lammegryte".
  const items = [item("Wok med nudler og grønnsaker"), item("Lammegryte med skall poteter")];
  assert.equal(pickMainDish(items, "Eat the street")?.dish, "Lammegryte med skall poteter");
});

test("fish cakes outrank a bean stew", () => {
  // Regression: 'stenbit' was absent, so the bean stew won on a tie.
  const items = [
    item("Bønnegryte med stekte poteter"),
    item("Stenbitkaker med eggesmør, råkost og potet"),
  ];
  assert.equal(
    pickMainDish(items, "Fresh4you")?.dish,
    "Stenbitkaker med eggesmør, råkost og potet"
  );
});

test("turkey and schnitzel count as centrepieces", () => {
  assert.ok(scoreMainDish("Kalkunfilet med saus", "Flow") > 0);
  assert.ok(scoreMainDish("Wienerschnitzel", "Flow") > 0);
});

test("'lam' does not fire on unrelated substrings", () => {
  // Guard for the word-boundary: these must not read as lamb.
  assert.equal(scoreMainDish("Lammefjord potetsalat", "Flow") > 0, true); // 'lamme' is intentional
  assert.equal(scoreMainDish("Flammkuchen", "Flow"), 0);
});

test("rankItems marks exactly one main and preserves order on ties", () => {
  const items = [item("Salat A"), item("Salat B"), item("Salat C")];
  const ranked = rankItems(items, "Flow");
  assert.equal(ranked.filter((i) => i.isMain).length, 1);
  assert.deepEqual(
    ranked.map((i) => i.dish),
    ["Salat A", "Salat B", "Salat C"]
  );
});

test("rankItems on empty input returns empty, not a crash", () => {
  assert.deepEqual(rankItems([], "Flow"), []);
  assert.deepEqual(rankItems(undefined, "Flow"), []);
  assert.equal(pickMainDish(undefined, "Flow"), undefined);
});

test("client, scraper and updater agree on the same winner", () => {
  // The property that actually matters: one ranking module, one answer.
  const items = [
    item("Pizza med salami og oliven"),
    item("Panert rødspettefilet med stekte poteter og tartarsaus"),
    item("Gurkemeie kyllingsuppe"),
  ];
  assert.equal(
    pickMainDish(items, "Eat the street")?.dish,
    "Panert rødspettefilet med stekte poteter og tartarsaus"
  );
});
