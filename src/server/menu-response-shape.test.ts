import test from "node:test";
import assert from "node:assert/strict";
import { menuResponseKey, MENU_RESPONSE_SHAPE } from "./services/redis.service.js";
import type { WeeklyMenuResponse } from "./menu.js";

/**
 * A cached `/api/menu` response is a whole serialised `WeeklyMenuResponse`
 * stored under a key derived from the week. Add a field to that interface and
 * every entry the previous deploy wrote is still a cache hit, returned verbatim
 * without the new field — no throw, no log, and the client falls back as though
 * the server had never shipped.
 *
 * That is how `weekId` went green through CI and a successful production deploy
 * and was still missing from fbueat.vercel.app afterwards.
 *
 * These two tests are the tripwire. The fixture below is typed as the real
 * interface, so adding a field breaks the typecheck first; fixing that then
 * breaks the assertion here, whose message says what else to do.
 */

/** Every field a cached response carries. Typed, so it cannot drift silently. */
const RESPONSE_FIXTURE: WeeklyMenuResponse = {
  weekId: "2026-W37",
  menuData: { scrapedAt: "", canteens: {} },
  dishOrigins: {},
  dishDescriptions: {},
  plateImages: {},
};

test("a new field on WeeklyMenuResponse must bump MENU_RESPONSE_SHAPE", () => {
  assert.deepEqual(
    Object.keys(RESPONSE_FIXTURE).sort(),
    ["dishDescriptions", "dishOrigins", "menuData", "plateImages", "weekId"],
    "WeeklyMenuResponse changed shape. Entries written by the running deploy " +
      "are still cache hits and will be served without the new field for the " +
      "whole TTL. Bump MENU_RESPONSE_SHAPE in redis.service.ts, then update " +
      "this list."
  );
});

test("read, write and invalidate agree on the key", () => {
  // The four call sites used to build this string themselves. One of them
  // disagreeing means a write nothing reads, or an invalidation that clears
  // nothing, and neither fails loudly.
  assert.equal(menuResponseKey(), `response:menu:${MENU_RESPONSE_SHAPE}:current`);
  assert.equal(menuResponseKey("2026-W37"), `response:menu:${MENU_RESPONSE_SHAPE}:2026-W37`);

  // `invalidateMenuResponseCache` passes no argument for the implicit request,
  // while the read passes `weekId` straight through as `undefined`. Those must
  // land on the same key or the app's own update never clears what it serves.
  assert.equal(menuResponseKey(undefined), menuResponseKey());
  assert.equal(menuResponseKey(""), menuResponseKey());
});

test("the version is part of the key, not decoration", () => {
  assert.ok(
    menuResponseKey().includes(MENU_RESPONSE_SHAPE),
    "bumping the version must make old entries unreachable"
  );
});
