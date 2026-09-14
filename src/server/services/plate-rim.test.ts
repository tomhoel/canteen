import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { plateRimDistance } from "./image.service.js";

/**
 * The numbers below are not invented. Each is the rim colour actually measured
 * off a stored plate on 2026-09-14, when a survey of all 335 archived plates
 * found 324 matching the reference and 11 that did not. If this check stops
 * separating them, an off-template plate gets archived permanently — the
 * archive is write-once and only `force` ever redraws it.
 */

/** A flat disc of one colour, shaped like removeBgBuffer's output: a plate
 *  covering ~86% of a transparent square frame. */
async function plate(r: number, g: number, b: number, size = 1024): Promise<Buffer> {
  const radius = Math.round((size * 0.86) / 2);
  const svg =
    `<svg width="${size}" height="${size}">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="rgb(${r},${g},${b})"/>` +
    `</svg>`;
  return await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: Buffer.from(svg) }])
    .png()
    .toBuffer();
}

test("plateRimDistance - the reference plate's own rim colour is on-template", async () => {
  // Measured off the 324 archived plates that match: hue 33, saturation 0.39.
  assert.ok((await plateRimDistance(await plate(217, 180, 133)))! <= 1);
});

test("plateRimDistance - accepts the full spread of plates that actually match", async () => {
  // The tightest and widest real measurements from the 324-plate cluster.
  for (const [r, g, b] of [
    [210, 173, 127],
    [220, 181, 134],
    [216, 179, 133],
  ]) {
    const d = await plateRimDistance(await plate(r, g, b));
    assert.ok(d !== null && d <= 1, `rgb(${r},${g},${b}) should be on-template, got ${d}`);
  }
});

test("plateRimDistance - rejects the terracotta plate the model drew on 2026-09-09", async () => {
  // Eat the Street's Monday plate: the reference was attached and ignored.
  // hue 22 against 33, saturation 0.62 against 0.39.
  const d = await plateRimDistance(await plate(210, 127, 79));
  assert.ok(d !== null && d > 1, `expected off-template, got ${d}`);
});

test("plateRimDistance - rejects the pale plates drawn with no reference at all", async () => {
  // 14-16 Aug 2026, when getMasterPlateRef had cached a failure for the whole
  // run. Right hue, far too little saturation — the subtler failure, and the
  // one a hue-only check would wave through.
  for (const [r, g, b] of [
    [219, 197, 163],
    [229, 213, 185],
    [209, 187, 154],
  ]) {
    const d = await plateRimDistance(await plate(r, g, b));
    assert.ok(d !== null && d > 1, `rgb(${r},${g},${b}) should be off-template, got ${d}`);
  }
});

test("plateRimDistance - an unmeasurable image is null, not a rejection", async () => {
  // Null means "could not find a rim", which must not be treated as "wrong
  // plate": redrawing would not make it measurable, so the caller keeps it.
  const empty = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer();
  assert.equal(await plateRimDistance(empty), null);
});
