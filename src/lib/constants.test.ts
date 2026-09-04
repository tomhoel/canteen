import test from "node:test";
import assert from "node:assert/strict";
import { getSupabaseImageUrl, getClosedPlateUrl, getCanteenMetadata, getLocationStatus } from "./constants";

/**
 * These assertions look pedantic and are not. Every one of them corresponds to
 * a way this URL has silently returned the wrong bytes with a 200 status.
 */

test("getSupabaseImageUrl - an untransformed request goes to the object endpoint", () => {
  const url = getSupabaseImageUrl("images_nobg", "monday/flow.png");
  assert.match(url, /\/storage\/v1\/object\/public\/images_nobg\/monday\/flow\.png$/);
  assert.ok(!url.includes("?"), "no query string when nothing was asked for");
});

test("getSupabaseImageUrl - a sized request goes to the render endpoint", () => {
  // /object/public answers 200 and ignores the query string entirely, so asking
  // it for a 440px WebP quietly returns the 1.5 MB source PNG.
  const url = getSupabaseImageUrl("images_nobg", "monday/flow.png", { width: 440, format: "webp" });
  assert.match(url, /\/storage\/v1\/render\/image\/public\//);
  assert.ok(url.includes("width=440"));
  assert.ok(url.includes("format=webp"));
});

test("getSupabaseImageUrl - a transform always pins resize=contain", () => {
  // The render endpoint defaults to `cover`. With a width and no height that
  // crops instead of scaling: 1024x1021 comes back as 440x1021, i.e. a vertical
  // slice with the left and right thirds of the plate missing.
  assert.ok(getSupabaseImageUrl("b", "p.png", { width: 440 }).includes("resize=contain"));
  assert.ok(getSupabaseImageUrl("b", "p.png", { quality: 70 }).includes("resize=contain"));
  assert.ok(
    getSupabaseImageUrl("b", "p.png", { width: 440, height: 440 }).includes("resize=contain")
  );
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

test("getClosedPlateUrl - transforms through the render endpoint too", () => {
  const url = getClosedPlateUrl("Flow-monday", { width: 440, format: "webp" });
  assert.match(url, /\/render\/image\/public\//);
  assert.ok(url.includes("resize=contain"));
});

test("getSupabaseImageUrl - percent-encodes each path segment, but not the slashes", () => {
  // Paths are dish names now: "archive/spanish pork casserole with potatoes.png"
  // is a real object. A raw space happens to survive because browsers encode it,
  // but a "?" would swallow the rest of the path into the query string.
  const url = getSupabaseImageUrl("images_nobg", "archive/spanish pork casserole.png", {
    width: 440,
  });
  assert.ok(url.includes("/images_nobg/archive/spanish%20pork%20casserole.png?"));
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
  assert.equal(m.hours, "10:30 – 13:00");
  assert.equal(m.subName, "Tidligere Flow");

  // Eat the street -> Eat The Street
  const street = getCanteenMetadata("Eat the street");
  assert.equal(street.name, "Eat The Street");
  assert.equal(street.building, "Bygg J/K");
  assert.equal(street.hours, "10:30 – 14:00");

  // Fresh4you -> Fresh 4 You
  const fresh = getCanteenMetadata("Fresh4you");
  assert.equal(fresh.name, "Fresh 4 You");
  assert.equal(fresh.building, "Bygg C/D");
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

test("getLocationStatus - correctly detects open, opening-soon, and closed states", () => {
  const street = getCanteenMetadata("Eat the street");

  // Wednesday at 11:30 Oslo time (UTC 09:30 or 10:30 depending on DST)
  // Let's create an ISO string with explicit Oslo offset +02:00
  const openTime = new Date("2026-09-02T11:30:00+02:00");
  const statusOpen = getLocationStatus(street, openTime);
  assert.equal(statusOpen.isOpen, true);
  assert.equal(statusOpen.badgeVariant, "open");

  // Wednesday at 10:15 Oslo time -> opening soon
  const soonTime = new Date("2026-09-02T10:15:00+02:00");
  const statusSoon = getLocationStatus(street, soonTime);
  assert.equal(statusSoon.isOpen, false);
  assert.equal(statusSoon.badgeVariant, "opening-soon");

  // Wednesday at 14:30 Oslo time -> closed
  const closedTime = new Date("2026-09-02T14:30:00+02:00");
  const statusClosed = getLocationStatus(street, closedTime);
  assert.equal(statusClosed.isOpen, false);
  assert.equal(statusClosed.badgeVariant, "closed");

  // Sunday at 12:00 -> closed
  const weekendTime = new Date("2026-09-06T12:00:00+02:00");
  const statusWeekend = getLocationStatus(street, weekendTime);
  assert.equal(statusWeekend.isOpen, false);
  assert.equal(statusWeekend.badgeVariant, "closed");
});
