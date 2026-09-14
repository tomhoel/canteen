import test from "node:test";
import assert from "node:assert/strict";
import { getSupabaseImageUrl, getClosedPlateUrl, getCanteenMetadata } from "./constants";

/**
 * These assertions look pedantic and are not. Every one of them corresponds to
 * a way this URL has silently returned the wrong bytes with a 200 status.
 */

test("getSupabaseImageUrl - an untransformed request goes to the blob object path", () => {
  const url = getSupabaseImageUrl("images_nobg", "monday/flow.png");
  assert.ok(url.endsWith("/images_nobg/monday/flow.png"));
  assert.ok(!url.includes("?"), "no query string when nothing was asked for");
});

test("getClosedPlateUrl - picks one of three plates, stably, per seed", () => {
  const first = getClosedPlateUrl("Flow-monday");
  assert.equal(first, getClosedPlateUrl("Flow-monday"), "the same seed always resolves the same");
  assert.match(first, /closed-plates\/closed-plate-[123]\.png/);

  const variants = new Set(
    ["Flow", "Fresh4you", "Eat the street"].flatMap((c) =>
      ["monday", "tuesday", "wednesday", "thursday", "friday"].map((d) =>
        getClosedPlateUrl(`${c}-${d}`).match(/closed-plate-(\d)/)![1]
      )
    )
  );
  assert.ok(variants.size > 1, "a whole week of closed canteens should not be one image");
});

test("getSupabaseImageUrl - percent-encodes each path segment, but not the slashes", () => {
  // Paths are dish names now: "archive/spanish pork casserole with potatoes.png"
  // is a real object. A raw space happens to survive because browsers encode it,
  // but a "?" would swallow the rest of the path into the query string.
  const url = getSupabaseImageUrl("images_nobg", "archive/spanish pork casserole.png");
  assert.ok(url.includes("/images_nobg/archive/spanish%20pork%20casserole.png"));
  assert.ok(!url.includes("archive%2F"), "the separator must stay a separator");
});

test("getSupabaseImageUrl - a plain slot path is untouched by the encoding", () => {
  assert.ok(
    getSupabaseImageUrl("images_nobg", "monday/flow.png").endsWith("/images_nobg/monday/flow.png")
  );
});

test("getCanteenMetadata - resolves canonical and legacy canteen names", () => {
  // Flow -> Kantine M
  const m = getCanteenMetadata("Flow");
  assert.equal(m.name, "Kantine M");
  assert.equal(m.building, "Bygg M, 2. etasje");
  assert.equal(m.buildingCode, "M");
  assert.equal(m.hours, "10:30 – 13:00");
  assert.equal(m.subName, "Tidligere Flow");

  // Eat the street -> Eat The Street
  const street = getCanteenMetadata("Eat the street");
  assert.equal(street.name, "Eat The Street");
  assert.equal(street.building, "Bygg J/K");
  assert.equal(street.buildingCode, "J/K");
  assert.equal(street.hours, "10:30 – 14:00");

  // Fresh4you -> Fresh 4 You
  const fresh = getCanteenMetadata("Fresh4you");
  assert.equal(fresh.name, "Fresh 4 You");
  assert.equal(fresh.building, "Bygg C/D");
  assert.equal(fresh.buildingCode, "C/D");
  assert.equal(fresh.hours, "10:30 – 13:00");

  // Bakern
  const bakern = getCanteenMetadata("Bakern");
  assert.equal(bakern.name, "Bakern");
  assert.equal(bakern.building, "Bygg C");
  assert.equal(bakern.type, "bakery");

  // Café Expo
  const expo = getCanteenMetadata("Café Expo");
  assert.equal(expo.name, "Café Expo");
  assert.equal(expo.building, "Bygg A / Expo");

  // Hot Spot
  const hot = getCanteenMetadata("Hot Spot");
  assert.equal(hot.name, "Hot Spot");
  assert.equal(hot.building, "Bygg G");

  // Fallback for unknown
  const unknown = getCanteenMetadata("Random Cafe");
  assert.equal(unknown.name, "Random Cafe");
  assert.ok(unknown.building);
});
