import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CANTEENS, parseDailyHtml } from "./scraper.service.js";

/**
 * The fixtures are verbatim captures of the three live "DAGENS LUNSJ" widgets.
 *
 * They are kept whole rather than trimmed to the interesting element because
 * the parser's whole job is to survive this markup: the nesting is the bug
 * surface, and a hand-tidied excerpt would quietly stop reproducing it.
 */
const fixture = (name: string) =>
  fs.readFileSync(new URL(`./__fixtures__/daily-${name}.html`, import.meta.url), "utf8");

const canteen = (displayName: string) =>
  CANTEENS.find((c) => c.displayName === displayName)!;

type Menu = { items: { dish: string; isMain: boolean; allergens: { id: string }[] }[] } | undefined;

const dishes = (menu: Menu) => (menu?.items ?? []).map((i) => i.dish);

const allergenIds = (menu: Menu, dish: string) =>
  (menu?.items ?? []).find((i) => i.dish === dish)?.allergens.map((a) => a.id).sort() ?? null;

const ALL = [
  ["fresh4you", "Fresh4you"],
  ["eat-the-street", "Eat the street"],
  ["flow", "Flow"],
] as const;

test("parseDailyHtml - reads a dish the widget left outside an <h2>", () => {
  // Fresh4you's third Norwegian dish is not in an <h2>. It sits inside a
  // `.menu-item-allergens` div as a bold 32px span, and its "Allergener:2"
  // lands in the *next* `.menu-item` block. A parser that trusts the markup's
  // own element types returns two dishes here and silently loses the fish.
  const daily = parseDailyHtml(fixture("fresh4you"), canteen("Fresh4you"), "friday");

  assert.deepEqual(dishes(daily.no).sort(), [
    "Norsk bondesuppe med rotgrønnsaker og urøkt pølse",
    "Ovnsbakt torsk med rattatouille og saltbakte poteter",
    "Stekt ris med egg, karri og grønnsaker",
  ]);
  assert.deepEqual(
    allergenIds(daily.no, "Ovnsbakt torsk med rattatouille og saltbakte poteter"),
    ["2"]
  );
});

test("parseDailyHtml - pairs each dish with its own allergen line", () => {
  const daily = parseDailyHtml(fixture("fresh4you"), canteen("Fresh4you"), "friday");
  assert.deepEqual(allergenIds(daily.no, "Stekt ris med egg, karri og grønnsaker"), ["1"]);
  assert.deepEqual(
    allergenIds(daily.no, "Norsk bondesuppe med rotgrønnsaker og urøkt pølse"),
    ["7"]
  );
});

test("parseDailyHtml - both language columns are read", () => {
  const daily = parseDailyHtml(fixture("fresh4you"), canteen("Fresh4you"), "friday");
  assert.equal(daily.no?.items.length, 3);
  assert.equal(daily.en?.items.length, 3);
  assert.ok(dishes(daily.en).includes("Fried rice with egg, curry and vegetables"));
  // The label comes from the caller's day, since the widget never says.
  assert.equal(daily.no?.label, "FREDAG");
  assert.equal(daily.en?.label, "FRIDAY");
});

test("parseDailyHtml - an empty 'Allergener:' line is not a dish", () => {
  // Eat the street leaves the allergen line blank on two of its four dishes,
  // and types "Allergener:" instead of "Allergens:" in the English column.
  // Both must still read as allergen lines, or they become phantom dishes.
  const daily = parseDailyHtml(fixture("eat-the-street"), canteen("Eat the street"), "friday");

  assert.equal(daily.no?.items.length, 4);
  assert.equal(daily.en?.items.length, 4);
  assert.deepEqual(allergenIds(daily.no, "Kikertsuppe med urte"), []);
  assert.deepEqual(allergenIds(daily.no, "Pizza med salami og ruccola"), ["3", "4"]);
});

test("parseDailyHtml - a dietary note is recorded without discarding its dish", () => {
  // The weekly parser drops any line carrying an availability note, because
  // there the note is its own standalone line. On the daily board the note is
  // appended to a real dish, so dropping the line would drop the food.
  const daily = parseDailyHtml(fixture("eat-the-street"), canteen("Eat the street"), "friday");

  assert.ok(daily.no?.availabilityNotes?.includes("Halal tilgjengelig"));
  assert.ok(
    dishes(daily.no).some((d) => d.startsWith("Tandoori kyllinglår med ris og saus")),
    `expected the Tandoori dish to survive, got ${JSON.stringify(dishes(daily.no))}`
  );
  assert.ok(
    !dishes(daily.no).some((d) => d.includes("Halal tilgjengelig")),
    "the note should be lifted out of the dish title"
  );
});

test("parseDailyHtml - allergens published in a bare <h2> still attach", () => {
  // Flow puts one dish's allergens in an <h2> with no allergens class at all.
  // Classifying fragments by text rather than by element is what catches it.
  const daily = parseDailyHtml(fixture("flow"), canteen("Flow"), "friday");

  assert.equal(daily.no?.items.length, 3);
  assert.deepEqual(allergenIds(daily.no, "Lasagne av aubergine"), ["4"]);
  assert.deepEqual(allergenIds(daily.no, "Kakitamajiru Japansk klar sopp suppe"), ["7"]);
});

test("parseDailyHtml - the allergen legend is never read as dishes", () => {
  // Every fixture ends with a 16-cell `.allergen-holder` table naming all the
  // allergens. Scoping to `.menu-item-holder` is what keeps it out.
  for (const [name, display] of ALL) {
    const daily = parseDailyHtml(fixture(name), canteen(display), "friday");
    const all = [...dishes(daily.no), ...dishes(daily.en)];
    assert.ok(all.length > 0 && all.length <= 8, `${name}: ${all.length} dishes`);
    for (const legend of ["Nøtter/Nuts", "Sulfitter/Sulfites", "Bløtdyr/Mulluscs"]) {
      assert.ok(!all.includes(legend), `${name} leaked the legend row "${legend}"`);
    }
  }
});

test("parseDailyHtml - the 'DAGENS LUNSj' heading is never read as a dish", () => {
  // isLikelyThemeHeader would not catch this one: the widget's own casing is
  // mixed, so the all-caps test it relies on returns false.
  for (const [name, display] of ALL) {
    const daily = parseDailyHtml(fixture(name), canteen(display), "friday");
    const all = [...dishes(daily.no), ...dishes(daily.en)].map((d) => d.toUpperCase());
    assert.ok(!all.includes("DAGENS LUNSJ"), name);
    assert.ok(!all.includes("TODAYS LUNCH"), name);
  }
});

test("parseDailyHtml - exactly one dish is ranked as the main", () => {
  // isMain drives both the card title and, through pickMainDish, which plate
  // image is shown. If those two can disagree the picture names another dish.
  for (const [name, display] of ALL) {
    const daily = parseDailyHtml(fixture(name), canteen(display), "friday");
    for (const lang of ["no", "en"] as const) {
      const mains = (daily[lang]?.items ?? []).filter((i) => i.isMain);
      assert.equal(mains.length, 1, `${name}/${lang}: ${mains.length} mains`);
    }
  }
});

test("parseDailyHtml - unrecognised markup yields nothing rather than junk", () => {
  const daily = parseDailyHtml("<html><body><p>Stengt</p></body></html>", canteen("Flow"), "friday");
  assert.equal(daily.no, undefined);
  assert.equal(daily.en, undefined);
});

test("parseDailyHtml - a single-dish board is rejected", () => {
  // One dish is far likelier to be markup we no longer understand than a
  // kitchen serving one thing, and a bad override costs a correct week.
  const one =
    `<html><body><div class="menu-item-holder first-holder">` +
    `<h1>DAGENS LUNSj</h1>` +
    `<div class="menu-item"><h2>Kylling</h2>` +
    `<div class="menu-item-allergens">Allergener:1</div></div>` +
    `</div></body></html>`;
  assert.equal(parseDailyHtml(one, canteen("Flow"), "friday").no, undefined);
});

test("every canteen has a distinct daily token, separate from its weekly one", () => {
  const daily = CANTEENS.map((c) => c.dailyToken);
  const weekly = CANTEENS.map((c) => c.token);
  assert.equal(new Set(daily).size, CANTEENS.length);
  assert.equal(new Set([...daily, ...weekly]).size, CANTEENS.length * 2);
});
