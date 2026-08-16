import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDishName,
  activeEnrichAttempts,
  isEnrichmentExhausted,
  MAX_ENRICH_ATTEMPTS,
  ENRICH_RETRY_COOLDOWN_MS,
  type DishCacheRow,
} from "./dish-cache.service";

const NOW = Date.parse("2026-08-16T12:00:00.000Z");

function row(overrides: Partial<DishCacheRow> = {}): DishCacheRow {
  return {
    cacheKey: "fiskesuppe",
    originalName: "Fiskesuppe",
    origin: null,
    description: null,
    imagePath: null,
    imageNoBgPath: null,
    enrichAttempts: 0,
    lastEnrichAttempt: null,
    ...overrides,
  };
}

test("normalizeDishName - collapses the drift a kitchen introduces between weeks", () => {
  assert.equal(normalizeDishName("  Kylling   med RIS  "), "kylling med ris");
  assert.equal(normalizeDishName("Kylling m/ris (7)"), "kylling mris 7");
  assert.equal(normalizeDishName(""), "");
});

test("normalizeDishName - keeps Norwegian letters, which the cache keys depend on", () => {
  assert.equal(normalizeDishName("Kjøttkaker med ertestuing"), "kjøttkaker med ertestuing");
});

test("activeEnrichAttempts - an unseen dish has none", () => {
  assert.equal(activeEnrichAttempts(undefined, NOW), 0);
  assert.equal(activeEnrichAttempts(row(), NOW), 0);
});

test("activeEnrichAttempts - recent attempts count against the cap", () => {
  const recent = row({
    enrichAttempts: 3,
    lastEnrichAttempt: new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(activeEnrichAttempts(recent, NOW), 3);
  assert.equal(isEnrichmentExhausted(recent, NOW), false);
});

test("isEnrichmentExhausted - the cap is reached exactly at MAX_ENRICH_ATTEMPTS", () => {
  const at = row({ enrichAttempts: MAX_ENRICH_ATTEMPTS, lastEnrichAttempt: new Date(NOW).toISOString() });
  const under = row({ enrichAttempts: MAX_ENRICH_ATTEMPTS - 1, lastEnrichAttempt: new Date(NOW).toISOString() });
  assert.equal(isEnrichmentExhausted(at, NOW), true);
  assert.equal(isEnrichmentExhausted(under, NOW), false);
});

test("activeEnrichAttempts - the cooldown re-arms a dish that was given up on", () => {
  // Without this, a dish that failed five times during one bad week would never
  // be asked about again for the life of the row — including months later, when
  // whatever was wrong is long fixed and the dish comes back on the menu.
  const stale = row({
    enrichAttempts: MAX_ENRICH_ATTEMPTS,
    lastEnrichAttempt: new Date(NOW - ENRICH_RETRY_COOLDOWN_MS - 1000).toISOString(),
  });
  assert.equal(activeEnrichAttempts(stale, NOW), 0);
  assert.equal(isEnrichmentExhausted(stale, NOW), false, "one more try is granted");
});

test("activeEnrichAttempts - one day short of the cooldown is still exhausted", () => {
  const almost = row({
    enrichAttempts: MAX_ENRICH_ATTEMPTS,
    lastEnrichAttempt: new Date(NOW - ENRICH_RETRY_COOLDOWN_MS + 24 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(isEnrichmentExhausted(almost, NOW), true);
});

test("activeEnrichAttempts - a counter with no timestamp is taken at face value", () => {
  // Rows written before the columns existed, or by a caller that only bumped
  // the count. Trusting the count is the safe direction: it stops sending.
  assert.equal(activeEnrichAttempts(row({ enrichAttempts: 9 }), NOW), 9);
  assert.equal(activeEnrichAttempts(row({ enrichAttempts: 2, lastEnrichAttempt: "not a date" }), NOW), 2);
});
