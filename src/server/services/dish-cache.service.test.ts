import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDishName,
  archiveObjectKey,
} from "./dish-cache.service";

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

