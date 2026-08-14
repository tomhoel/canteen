import test from "node:test";
import assert from "node:assert/strict";
import { parseItem, mergeItems, extractAvailabilityNote } from "./scraper.service.ts";

const names = (item: ReturnType<typeof parseItem>) => item.allergens.map((a) => a.name).sort();

test("parseItem - extracts allergen digits jammed mid-string", () => {
  // Real line from the Fresh4you widget: the canteen types the allergen
  // numbers inline, so they land glued to the following word.
  const r = parseItem("Stenbitkaker med eggesmør, råkost og 2,4potet");
  assert.equal(r.dish, "Stenbitkaker med eggesmør, råkost og potet");
  assert.deepEqual(names(r), ["Fish", "Milk"]);
});

test("parseItem - leaves quantities alone", () => {
  // "200g" must not be mistaken for allergen ids.
  const r = parseItem("Biff 200g med potetmos");
  assert.equal(r.dish, "Biff 200g med potetmos");
  assert.deepEqual(names(r), []);
});

test("parseItem - does not strip a number that is not an allergen id", () => {
  const r = parseItem("Pizza nr 22bit");
  assert.ok(r.dish.includes("22"));
  assert.deepEqual(names(r), []);
});

test("parseItem - parenthesised allergens still work", () => {
  const r = parseItem("Karbonader (1,3,4) med saus");
  assert.equal(r.dish, "Karbonader med saus");
  assert.deepEqual(names(r), ["Egg", "Gluten", "Milk"]);
});

test("parseItem - trailing bare allergens still work", () => {
  const r = parseItem("Betasuppe med røkt pølse 7");
  assert.equal(r.dish, "Betasuppe med røkt pølse");
  assert.deepEqual(names(r), ["Celery"]);
});

test("parseItem - plain dish name is untouched", () => {
  const r = parseItem("Kremet aspargessuppe");
  assert.equal(r.dish, "Kremet aspargessuppe");
  assert.deepEqual(names(r), []);
});

test("mergeItems - joins a continuation line starting lowercase", () => {
  assert.deepEqual(mergeItems(["Torsk med sitron", "og dillsaus"]), [
    "Torsk med sitron og dillsaus",
  ]);
});

test("extractAvailabilityNote - picks out dietary notes", () => {
  assert.equal(extractAvailabilityNote("Kylling (halal)"), "halal");
  assert.equal(extractAvailabilityNote("Karbonader (1,3)"), null);
});
