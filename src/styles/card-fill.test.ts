import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * Guards the mechanism that lets a food card use the space it actually has.
 *
 * The card's three parts — plate, text column, ANDRE RETTER — used to be laid
 * out as a wrapped flex row, which meant the text column had to be capped by
 * hand so a long dish name could not push the side dishes out of a card whose
 * height is fixed. The cap that got written was
 * `--plate-size + --plate-pull-y + --plate-pull-b`: a number describing the
 * PLATE, used as the budget for the TEXT. It was 114px on a 390x844 screen
 * against a real budget of 116px, 140px or 159px depending on how many side
 * dishes the kitchen published that day, so the description was clamped to one
 * line and fourteen of the week's fifteen cards threw away between one and six
 * lines of room.
 *
 * Two rules replaced it, and both are easy to undo by accident:
 *
 *   1. `grid-template-rows: minmax(0, 1fr) auto` — ANDRE RETTER takes what it
 *      needs and the text column gets the rest. Reintroducing a static
 *      max-height on .card-content puts the cap back.
 *   2. `max-height: round(down, 100%, 1lh)` on the description — the leftover
 *      is a continuous number of pixels and almost never a whole number of
 *      lines, so without the rounding every card showed a 3-15px slice of the
 *      next line's letter-tops. Reintroducing a numeric `-webkit-line-clamp`
 *      makes the count static again.
 *
 * This reads the shipped stylesheet, not a copy of the values.
 */

// Normalised, because the file is checked in with CRLF endings and every
// anchor below is written with "\n".
const CSS = fs
  .readFileSync(new URL("./globals.css", import.meta.url), "utf8")
  .replace(/\r\n/g, "\n");

/** The `@media (max-width: 768px)` block that carries the phone layout. */
const MOBILE = (() => {
  const start = CSS.indexOf("@media (max-width: 768px) {\n  .app-wrapper");
  assert.ok(start !== -1, "the phone media block moved; this test cannot find it");
  return CSS.slice(start);
})();

/**
 * The declarations of the first rule matching `selector {` in the phone block.
 *
 * Comments are stripped. These rules carry long ones that quote the very
 * declarations being asserted against — the first run of this file failed
 * because a comment explaining why `-webkit-line-clamp: 2` is wrong matched the
 * check for `-webkit-line-clamp: <number>`.
 */
function rule(selector: string): string {
  const at = MOBILE.indexOf(`\n  ${selector} {`);
  assert.ok(at !== -1, `${selector} is not declared in the phone media block`);
  const open = MOBILE.indexOf("{", at);
  const close = MOBILE.indexOf("\n  }", open);
  assert.ok(close !== -1, `${selector} has no closing brace`);
  return MOBILE.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, "");
}

test("the card is a grid whose first row takes whatever the side dishes leave", () => {
  const card = rule(".food-card");
  assert.match(card, /display:\s*grid/, "the card must be a grid, not a wrapped flex row");
  assert.match(
    card,
    /grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto/,
    "row 1 must be minmax(0, 1fr) and row 2 auto — that is what hands the text " +
      "column the leftover and lets it clip rather than overflow"
  );
});

test("the text column is not capped by a number describing the plate", () => {
  const content = rule(".card-content");
  assert.doesNotMatch(
    content,
    /max-height:/,
    "a max-height on .card-content is the cap this layout exists to remove. The " +
      "grid row is the ceiling; anything static here is smaller than the real " +
      "budget on every card with fewer than three side dishes."
  );
  assert.match(content, /display:\s*grid/, "the description needs a grid area for its 100% to mean 'what is left'");
  assert.match(content, /min-height:\s*0/, "without this the column refuses to shrink and never clips");
});

test("the description takes whole lines, and as many as fit", () => {
  const desc = rule(".dish-description");

  assert.match(
    desc,
    /max-height:\s*round\(down,\s*100%,\s*1lh\)/,
    "the leftover is not a whole number of lines; without rounding, every card " +
      "shows a slice of the next line's letter-tops"
  );
  // The plain 100% must stay directly above it as the fallback: if round() is
  // ever unavailable the declaration is dropped, and the box must still be
  // bounded by its row rather than unbounded.
  assert.match(desc, /max-height:\s*100%;[\s\S]*max-height:\s*round\(/, "keep the un-rounded fallback");

  assert.match(
    desc,
    /-webkit-line-clamp:\s*none/,
    "the desktop rule sets -webkit-line-clamp: 2 and it is inherited here; " +
      "leaving it half-applied gave two lines on one card and four on the next"
  );
  assert.doesNotMatch(
    desc,
    /-webkit-line-clamp:\s*\d/,
    "a numeric clamp makes the line count static again, which is the bug"
  );
});

test("short screens no longer hide the description outright", () => {
  const short = MOBILE.slice(MOBILE.indexOf("@media (max-height: 740px)"));
  const upTo = short.slice(0, short.indexOf("\n  /* Day bar"));
  assert.doesNotMatch(
    upTo,
    /\.dish-description\s*\{[^}]*display:\s*none/,
    "hiding it on every short screen was a workaround for the static cap. The " +
      "grid gives fewer whole lines, or none, on exactly the cards that cannot " +
      "spare them."
  );
  assert.doesNotMatch(
    upTo,
    /--plate-size:/,
    "the plate is not resized on short screens — it is the one element the card " +
      "is built around, and this block catches any window under 740px tall"
  );
});
