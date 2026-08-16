import test from "node:test";
import assert from "node:assert/strict";
import { getSupabaseImageUrl, getClosedPlateUrl } from "./constants";

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
