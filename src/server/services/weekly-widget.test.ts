import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseCanteenHtml, splitJammedDishes, CANTEENS } from "./scraper.service.js";

/**
 * The weekly widget, against markup captured from the live signage widgets on
 * 2026-10-01 (week 40). Until these existed, every weekly assertion ran on
 * hand-written HTML, so nobody could say which of the parser's guards the real
 * pages needed; with them, removing the child-div guard in extractSections is
 * seen to change the output for two of the three canteens, and the sibling-text
 * guard to change nothing, which is why only that one was deleted.
 *
 * The assertions are structural. The dishes are a snapshot, and a test that
 * names one is a test that fails when the kitchen changes its mind.
 */
const fixture = (name: string) =>
  fs.readFileSync(new URL(`./__fixtures__/weekly-${name}.html`, import.meta.url), "utf8");
const canteen = (name: string) => CANTEENS.find((c) => c.displayName === name)!;

const ALL: Array<[string, string]> = [
  ["eat-the-street", "Eat the street"],
  ["fresh4you", "Fresh4you"],
  ["flow", "Flow"],
];

test("weekly widget - every real canteen yields a week of ranked Norwegian dishes", () => {
  for (const [file, display] of ALL) {
    const data = parseCanteenHtml(fixture(file), canteen(display));
    assert.match(data.week, /\d/, `${display}: the week label carries a number`);
    assert.ok(data.menu.length >= 4 && data.menu.length <= 5, `${display}: ${data.menu.length} days`);
    for (const day of data.menu) {
      const items = day.no?.items ?? [];
      assert.ok(items.length >= 2 && items.length <= 6, `${display} ${day.day}: ${items.length} dishes`);
      assert.equal(items.filter((i) => i.isMain).length, 1, `${display} ${day.day}: exactly one main`);
      assert.ok(items.every((i) => i.dish.trim().length > 2), `${display} ${day.day}: no empty dishes`);
      assert.ok(!("en" in day), `${display} ${day.day}: the English copy is dropped`);
    }
  }
});

test("weekly widget - no dish is the same text twice, and none is a day or section heading", () => {
  for (const [file, display] of ALL) {
    for (const day of parseCanteenHtml(fixture(file), canteen(display)).menu) {
      const dishes = (day.no?.items ?? []).map((i) => i.dish.toLowerCase());
      assert.equal(new Set(dishes).size, dishes.length, `${display} ${day.day}: duplicate dish`);
      for (const d of dishes) {
        assert.ok(!/^(mandag|tirsdag|onsdag|torsdag|fredag|monday|tuesday|wednesday|thursday|friday)$/.test(d), d);
      }
    }
  }
});

test("weekly widget - the allergen legend and meat tags never become part of a dish", () => {
  for (const [file, display] of ALL) {
    for (const day of parseCanteenHtml(fixture(file), canteen(display)).menu) {
      for (const { dish } of day.no?.items ?? []) {
        assert.ok(!/\(\s*[\d,\s]+\)/.test(dish), `${display}: allergen group left in "${dish}"`);
        assert.ok(!/allergen/i.test(dish), `${display}: allergen label left in "${dish}"`);
      }
    }
  }
});

test("splitJammedDishes - two dishes typed with no space between them are two dishes", () => {
  // Real, from Flow week 40 and week 38. The AI proofreader used to glue these into
  // one title ("... i karri. Grønnsakssuppe fra Toscana"), so the soup vanished.
  assert.deepEqual(splitJammedDishes("Rotgrønnsak i karriGrønnsakssuppe fra Toscana"), [
    "Rotgrønnsak i karri",
    "Grønnsakssuppe fra Toscana",
  ]);
  assert.deepEqual(splitJammedDishes("Grillet søtpotet med olivensalsaBouillabaisse suppe"), [
    "Grillet søtpotet med olivensalsa",
    "Bouillabaisse suppe",
  ]);
});

test("splitJammedDishes - ordinary names, capitals and acronyms are left alone", () => {
  for (const name of ["Pasta Bolognese med parmesan", "BBQ-kylling med ris", "Fish & Chips med ertestuing", "Thai-suppe"]) {
    assert.deepEqual(splitJammedDishes(name), [name]);
  }
  // The allergen rule still works.
  assert.deepEqual(splitJammedDishes("Laks (4)Kylling (1)"), ["Laks (4)", "Kylling (1)"]);
});

test("weekly widget - the jammed dishes in Flow's real menu come out as separate dishes", () => {
  const data = parseCanteenHtml(fixture("flow"), canteen("Flow"));
  const all = data.menu.flatMap((d) => d.no?.items.map((i) => i.dish) ?? []);
  assert.ok(!all.some((d) => /[a-zæøå][A-ZÆØÅ][a-zæøå]/.test(d)), `a jam is left: ${all.filter((d) => /[a-zæøå][A-ZÆØÅ][a-zæøå]/.test(d))}`);
});
