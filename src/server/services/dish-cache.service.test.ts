import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDishName,
  archiveObjectKey,
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
    shortName: null,
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

test("archiveObjectKey - folds the letters Supabase Storage refuses in a key", () => {
  // Measured, not guessed: uploading `archive/svinekjøtt toppet med søtpotet
  // lokk.png` answers "Invalid key", while `archive/tandoori kylling med
  // ris.png` uploads and serves. Spaces are fine; å, ø and æ are not. Ten of a
  // typical week's fifteen dishes failed on this, and because a failed archive
  // records no path, the next run found nothing to reuse and paid to generate
  // the same plate again — twice a day, indefinitely.
  assert.equal(archiveObjectKey("Kjøttkaker med ertestuing"), "kjottkaker med ertestuing");
  assert.equal(archiveObjectKey("Svinekjøtt toppet med søtpotet lokk"), "svinekjott toppet med sotpotet lokk");
  assert.equal(archiveObjectKey("Stenbitkaker med eggesmør, råkost og potet"), "stenbitkaker med eggesmor rakost og potet");
  assert.equal(archiveObjectKey("Blåskjell og æbleskiver"), "blaskjell og aebleskiver");
});

test("archiveObjectKey - leaves an ASCII dish exactly as the cache key has it", () => {
  // The archive already holds objects under these names. Folding must be a
  // no-op for them, or every plate generated before today is orphaned and
  // silently repaid for.
  for (const dish of [
    "Tandoori kylling med ris",
    "Spanish pork casserole with potatoes",
    "Fransk kyllinggryte med ris",
  ]) {
    assert.equal(archiveObjectKey(dish), normalizeDishName(dish));
  }
});

test("archiveObjectKey - strips anything else that cannot live in an object key", () => {
  // Whatever survives the fold has to be plain ASCII: a key is not a display
  // name, and one rejected upload costs a regenerated image every run.
  assert.match(archiveObjectKey("Crème brûlée à la niçoise"), /^[a-z0-9 ]+$/);
  assert.equal(archiveObjectKey("Crème brûlée"), "creme brulee");
  assert.equal(archiveObjectKey("Fisk 🐟 med potet"), "fisk med potet");
  assert.equal(archiveObjectKey(""), "");
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
