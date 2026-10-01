import test from "node:test";
import assert from "node:assert/strict";
import { scoreMainDish, rankItems, pickMainDish, guessCourse } from "./dish-ranking";
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
  assert.equal(scoreMainDish("Lammefjord lammegryte", "Flow") > 0, true); // 'lamme' is intentional
  assert.ok(scoreMainDish("Flammkuchen", "Flow") < scoreMainDish("Lammegryte", "Flow"));
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

// ---- Course tiers (2026-10-01): plated meat/fish > mixed > veg > soup > side ----

test("2026-10-01 Flow Thursday: the fish beats porridge and the soups", () => {
  // Regression. Stekt sei has no keyword the old rules knew, Havregrøt scored
  // the same 0, and the kitchen's listing order made the porridge the headline.
  const items = [
    item("Havregrøt med bakte tomater, urte, løk, selleri, persille og olje"),
    item("Kalkunsuppe med ingefær og chili"),
    item("Stekt sei med erter, kål og dill"),
    item("Maissuppe"),
  ];
  assert.equal(pickMainDish(items, "Flow")?.dish, "Stekt sei med erter, kål og dill");
});

test("a meat soup never beats a plated dish", () => {
  const items = [item("Fransk kjøttsuppe"), item("Vegetar jambalaya"), item("Fish & Chips med ertestuing og tartarsaus")];
  assert.equal(pickMainDish(items, "Eat the street")?.dish, "Fish & Chips med ertestuing og tartarsaus");
});

test("vegan schnitzel and burgers are vegetarian, not meat", () => {
  // The old rules matched 'schnitzel' inside 'Veganschnitzel'.
  const items = [item("Veganschnitzel med ris"), item("Kyllingbryst med purreløksaus og ris")];
  assert.equal(pickMainDish(items, "Fresh4you")?.dish, "Kyllingbryst med purreløksaus og ris");
  assert.equal(guessCourse("Veganburger med brød og tilbehør"), "veg");
});

test("a salad is a side even with chicken in it, but 'pork with a salad' is a plate", () => {
  assert.equal(guessCourse("Cæsarsalat med kylling og bacon"), "side");
  assert.equal(guessCourse("Svinekam med gresk linsesalat"), "meat_plate");
});

test("a vegetarian dish wins only when nothing with meat or fish is on the board", () => {
  assert.equal(pickMainDish([item("Risotto med sopp"), item("Tomatsuppe")], "Flow")?.dish, "Risotto med sopp");
});

test("a stored label beats the name rules, except where the name settles it", () => {
  // The model knows 'Baccala' is fish; the rules do not.
  assert.equal(scoreMainDish("Baccala alla Vicentina", "Flow", "meat_plate") > scoreMainDish("Risotto med sopp", "Flow", "veg"), true);
  // A model label of 'meat_mixed' cannot turn a vegangulasj into a meat dish.
  assert.ok(scoreMainDish("Vegangulasj med poteter", "Flow", "meat_mixed") < scoreMainDish("Chicken tikka masala med ris", "Flow", "meat_mixed"));
  // Nor a soup into a main.
  assert.ok(scoreMainDish("Kalkunsuppe", "Flow", "meat_plate") < scoreMainDish("Wok med nudler og grønnsaker", "Flow"));
});

test("labels force a fresh ranking; stored decisions are returned untouched", () => {
  const stored = [{ ...item("Havregrøt"), isMain: true }, item("Stekt sei med erter")];
  // No labels: already decided, so the stored order stands (this is what the
  // server, the client and the image job do).
  assert.deepEqual(rankItems(stored, "Flow").map((i) => i.dish), ["Havregrøt", "Stekt sei med erter"]);
  // The updater passes labels, which re-ranks from scratch.
  const redecided = rankItems(stored, "Flow", { "Stekt sei med erter": "meat_plate", Havregrøt: "veg" });
  assert.equal(redecided[0].dish, "Stekt sei med erter");
  assert.equal(redecided.filter((i) => i.isMain).length, 1);
});

test("the composed-dish bonus only breaks ties inside a tier", () => {
  // Maximum bonus must stay below the smallest gap between tiers.
  assert.ok(scoreMainDish("Tomatsuppe med ris og brød, og mer med med", "Flow", "soup") < scoreMainDish("Vegetar bolle", "Flow", "veg"));
});

test("a hand-set override beats the model label and the name rules", () => {
  // W37 Friday: marinated mussels out-tiered Biff Szechuan med nudler.
  const items = [item("Biff Szechuan med nudler"), item("Marinerte økologiske blåskjell"), item("Tom Kha soppsuppe")];
  const ranked = rankItems(items, "Eat the street", {
    "Biff Szechuan med nudler": "meat_mixed",
    "Marinerte økologiske blåskjell": "meat_plate",
  });
  assert.equal(ranked[0].dish, "Biff Szechuan med nudler");
  // The same words with a different dish are not caught by it.
  assert.ok(scoreMainDish("Marinerte kyllinglår med karrisaus og ris", "Flow", "meat_plate") >= 80);
});

test("a vegetable wok the model called meat_mixed does not tie with a chicken dish", () => {
  // 2026-10-01 Eat the street: both scored 60 and the kitchen's order picked the wok.
  const items = [item("Hoisin wok med nudler og grønnsaker"), item("Butterkylling med ris")];
  const ranked = rankItems(items, "Eat the street", {
    "Hoisin wok med nudler og grønnsaker": "meat_mixed",
    "Butterkylling med ris": "meat_mixed",
  });
  assert.equal(ranked[0].dish, "Butterkylling med ris");
});
