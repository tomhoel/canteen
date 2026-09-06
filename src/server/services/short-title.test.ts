import test from "node:test";
import assert from "node:assert/strict";
import {
  validateShortTitle,
  needsShortening,
  SHORT_TITLE_TARGET_CHARS,
  SHORT_TITLE_MAX_CHARS,
} from "./ai.service.js";

/**
 * The short title is what the card puts in front of someone choosing where to
 * eat, so the only property that really matters is that the model cannot put a
 * different dish there. validateShortTitle enforces it by only ever accepting a
 * TRIM: every word of the short title has to come from the original.
 *
 * These are the real titles from the week this was written, plus the failure
 * modes a language model actually produces — translation, synonym substitution,
 * and helpfully inventing a shorter dish.
 */

test("accepts a trim that drops the trailing garnish", () => {
  assert.equal(
    validateShortTitle(
      "Bakt laks med stekt sitronpotet, rucola og ajvardressing",
      "Bakt laks med sitronpotet og rucola"
    ),
    true
  );
  assert.equal(
    validateShortTitle(
      "Tortilla med skavet kyllinglårfilet, serveres med hvitløksdressing eller salsa",
      "Tortilla med skavet kyllinglårfilet"
    ),
    true
  );
  assert.equal(
    validateShortTitle(
      "Ovnsbakt torskefilet med rattatouille og saltbakte poteter",
      "Ovnsbakt torskefilet med poteter"
    ),
    true
  );
});

test("tolerates Norwegian compound and inflection differences", () => {
  // "poteter" -> "potet" is one edit; a kept word need not match letter for letter.
  assert.equal(
    validateShortTitle(
      "Ovnsbakt torskefilet med rattatouille og saltbakte poteter",
      "Torskefilet med potet"
    ),
    true
  );
  // Compound split in the original, joined in the short form.
  assert.equal(
    validateShortTitle(
      "Kremet blomkål suppe med ristede gresskarkjerner og urter",
      "Kremet blomkålsuppe"
    ),
    true
  );
});

test("rejects a word the original never contained", () => {
  // The whole point: no inventing a dish.
  assert.equal(
    validateShortTitle("Bakt laks med stekt sitronpotet og rucola", "Kylling med ris"),
    false
  );
  // One smuggled word is enough to reject, even with the rest intact.
  assert.equal(
    validateShortTitle(
      "Bakt laks med stekt sitronpotet og rucola",
      "Bakt laks med sitronpotet og hvitløk"
    ),
    false
  );
});

test("rejects a translation", () => {
  assert.equal(
    validateShortTitle(
      "Ovnsbakt torskefilet med saltbakte poteter og urter",
      "Baked cod with potatoes"
    ),
    false
  );
});

test("rejects a synonym substitution", () => {
  assert.equal(
    validateShortTitle(
      "Ovnsbakt torskefilet med rattatouille og saltbakte poteter",
      "Ovnsbakt torsk med grønnsaker"
    ),
    false
  );
});

test("rejects a title stripped down past naming the dish", () => {
  // A single word is a trim, and is not a title.
  assert.equal(
    validateShortTitle("Bakt laks med stekt sitronpotet og rucola", "Laks"),
    false
  );
});

test("rejects anything that is not shorter", () => {
  const original = "Bakt laks med stekt sitronpotet og rucola";
  assert.equal(validateShortTitle(original, original), false);
  assert.equal(
    validateShortTitle(original, "Bakt laks med stekt sitronpotet og rucola og"),
    false
  );
});

test("rejects a shortening that is still over the hard ceiling", () => {
  // 96 chars in, 76 out: shorter, all words from the original, and still too
  // long to render. MAX is the last gate.
  const original =
    "Langtidsstekt svinenakke med ovnsbakte rotgrønnsaker, tyttebærsaus, poteter og surkål";
  const short = "Langtidsstekt svinenakke med ovnsbakte rotgrønnsaker og tyttebærsaus";
  assert.ok(short.length > SHORT_TITLE_MAX_CHARS);
  assert.ok(short.length < original.length);
  assert.equal(validateShortTitle(original, short), false);
});

test("rejects empty, blank and non-string answers", () => {
  const original = "Bakt laks med stekt sitronpotet og rucola";
  assert.equal(validateShortTitle(original, ""), false);
  assert.equal(validateShortTitle(original, "   "), false);
  assert.equal(validateShortTitle(original, null as unknown as string), false);
  assert.equal(validateShortTitle(original, 42 as unknown as string), false);
});

test("punctuation in either title is not a word", () => {
  // The original's comma must not make "rucola," unmatchable, and a short title
  // that only re-punctuates is still a trim.
  assert.equal(
    validateShortTitle(
      "Bakt laks med stekt sitronpotet, rucola og ajvardressing",
      "Bakt laks med rucola"
    ),
    true
  );
});

test("needsShortening fires only past the two-line budget", () => {
  // 44 chars — measured to fit two lines on a 390px screen.
  assert.equal(needsShortening("Sesambakt torskefilet med nudler og soyasaus"), false);
  // 56 chars — measured to wrap to three.
  assert.equal(
    needsShortening("Bakt laks med stekt sitronpotet, rucola og ajvardressing"),
    true
  );
  assert.equal(needsShortening("x".repeat(SHORT_TITLE_TARGET_CHARS)), false);
  assert.equal(needsShortening("x".repeat(SHORT_TITLE_TARGET_CHARS + 1)), true);
});

test("the ceiling is above the target, or nothing between them is reachable", () => {
  assert.ok(SHORT_TITLE_MAX_CHARS > SHORT_TITLE_TARGET_CHARS);
});
