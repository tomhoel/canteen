import test from "node:test";
import assert from "node:assert/strict";
import { isUsableCacheEntry, type CachedWeeklyMenu } from "./api-client.js";
import type { WeeklyMenuResponse } from "../server/menu.js";

/**
 * `getWeeklyMenu` is stale-while-revalidate: it returns the cached payload and
 * the fresh response only ever reaches localStorage, never React. So whatever
 * this predicate accepts is what the entire session renders from — for up to
 * six hours, and on an installed PWA that is nearly every launch.
 *
 * The bug these pin: `weekId` was added to the response, deployed, and
 * confirmed live on the API, and returning users still saw the pre-change
 * payload. Without `weekId` the weekend header falls back to the canteen labels
 * and reads "Uke 36 · Fredag 4. september" above week 37's food.
 */

const NOW = 1_757_068_800_000; // fixed; the module's own clock is not under test
const HOUR = 60 * 60 * 1000;

const response = (over: Partial<WeeklyMenuResponse> = {}): WeeklyMenuResponse => ({
  weekId: "2026-W37",
  menuData: { scrapedAt: "", canteens: {} },
  dishOrigins: {},
  dishDescriptions: {},
  plateImages: {},
  landingDay: "monday",
  ...over,
});

const entry = (over: Partial<CachedWeeklyMenu> = {}): CachedWeeklyMenu => ({
  timestamp: NOW - HOUR,
  week: "current",
  data: response(),
  ...over,
});

test("a complete, fresh entry is served", () => {
  assert.equal(isUsableCacheEntry(entry(), NOW), true);
});

test("an entry from a deploy that had no weekId is not a hit", () => {
  // The exact payload that was live in every returning user's localStorage.
  const old = entry();
  delete (old.data as Partial<WeeklyMenuResponse>).weekId;
  assert.equal(
    isUsableCacheEntry(old, NOW),
    false,
    "serving this pins the weekend header to the canteen labels for six hours"
  );
});

test("an empty-string weekId is still a miss, not a hit", () => {
  // `!= null` would accept "" — which reaches computeDisplayContext as falsy
  // and silently takes the fallback branch, i.e. the bug with extra steps.
  assert.equal(isUsableCacheEntry(entry({ data: response({ weekId: "" }) }), NOW), false);
});

test("menuData is still required", () => {
  const noMenu = entry();
  delete (noMenu.data as Partial<WeeklyMenuResponse>).menuData;
  assert.equal(isUsableCacheEntry(noMenu, NOW), false);
});

test("an entry older than the six-hour window is not served", () => {
  assert.equal(isUsableCacheEntry(entry({ timestamp: NOW - 7 * HOUR }), NOW), false);
  assert.equal(isUsableCacheEntry(entry({ timestamp: NOW - 5 * HOUR }), NOW), true);
});

test("a clock that has gone backwards does not resurrect an entry", () => {
  // A future timestamp makes `now - timestamp` negative, which is < the max age
  // and would read as fresh forever.
  assert.equal(isUsableCacheEntry(entry({ timestamp: NOW + 24 * HOUR }), NOW), false);
});

test("junk parses to a miss rather than throwing", () => {
  assert.equal(isUsableCacheEntry(null, NOW), false);
  assert.equal(isUsableCacheEntry({} as CachedWeeklyMenu, NOW), false);
  assert.equal(
    isUsableCacheEntry({ timestamp: NOW, week: "current" } as CachedWeeklyMenu, NOW),
    false
  );
});
