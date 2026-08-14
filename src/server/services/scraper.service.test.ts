import test from "node:test";
import assert from "node:assert/strict";
import {
  parseItem,
  mergeItems,
  extractAvailabilityNote,
  parseCanteenHtml,
  CANTEENS,
} from "./scraper.service";

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

// ── HTML parsing ──────────────────────────────────────────────────────────

const flow = CANTEENS.find((c) => c.displayName === "Flow")!;

const html = (body: string) =>
  `<html><body><h2>Bygg / Building M - Uke/Week 33</h2><div class="menu-container">${body}</div></body></html>`;

test("parseCanteenHtml - groups dishes under their day and language", () => {
  const data = parseCanteenHtml(
    html(`
      <h1>Mandag</h1><div>Torsk med sitron (2,4)</div><div>Tomatsuppe (7)</div>
      <h1>Monday</h1><div>Cod with lemon (2,4)</div><div>Tomato soup (7)</div>
    `),
    flow
  );

  assert.equal(data.menu.length, 1);
  assert.equal(data.menu[0].day, "Monday");
  assert.deepEqual(
    data.menu[0].no.items.map((i) => i.dish),
    ["Torsk med sitron", "Tomatsuppe"]
  );
  assert.deepEqual(
    data.menu[0].en.items.map((i) => i.dish),
    ["Cod with lemon", "Tomato soup"]
  );
});

test("parseCanteenHtml - recovers dishes the widget jams into an <h1>", () => {
  // Flow really emits this: a day's whole English menu inside a heading.
  const data = parseCanteenHtml(
    html(`
      <h1>Tuesday</h1>
      <h1>Lentil curry with coconut milk (7)Root vegetable soup (7)Tandoori chicken with rice (4)</h1>
    `),
    flow
  );

  const items = data.menu[0].en.items.map((i) => i.dish);
  assert.deepEqual(items.sort(), [
    "Lentil curry with coconut milk",
    "Root vegetable soup",
    "Tandoori chicken with rice",
  ].sort());
});

test("parseCanteenHtml - returns days in Monday-to-Friday order", () => {
  const data = parseCanteenHtml(
    html(`
      <h1>Fredag</h1><div>Fredagsrett</div>
      <h1>Mandag</h1><div>Mandagsrett</div>
      <h1>Onsdag</h1><div>Onsdagsrett</div>
    `),
    flow
  );

  assert.deepEqual(
    data.menu.map((d) => d.day),
    ["Monday", "Wednesday", "Friday"]
  );
});

test("parseCanteenHtml - a day published in only one language still appears", () => {
  const data = parseCanteenHtml(html(`<h1>Torsdag</h1><div>Kylling salsa med pasta</div>`), flow);
  assert.equal(data.menu.length, 1);
  assert.equal(data.menu[0].no.items.length, 1);
  assert.equal(data.menu[0].en, undefined);
});

test("parseCanteenHtml - marks exactly one main dish per language", () => {
  const data = parseCanteenHtml(
    html(`<h1>Mandag</h1><div>Tomatsuppe</div><div>Kylling med ris</div><div>Couscous</div>`),
    flow
  );
  const mains = data.menu[0].no.items.filter((i) => i.isMain);
  assert.equal(mains.length, 1);
  assert.equal(mains[0].dish, "Kylling med ris");
});
