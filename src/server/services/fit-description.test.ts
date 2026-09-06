import test from "node:test";
import assert from "node:assert/strict";
import {
  fitDescriptionText,
  fitDescription,
  DESCRIPTION_MAX_CHARS,
} from "./ai.service.js";

/**
 * The card shows two lines of description and nothing more. What arrives from
 * the model, and what is already sitting in dish_cache from when the prompt
 * asked for "under 110 characters", is routinely three or four lines — so it
 * was being cut off mid-sentence on the card, which is what these trim rules
 * exist to stop.
 *
 * The property that matters: what survives should read as finished. A shorter
 * complete sentence beats a longer truncated one, because a reader cannot tell
 * whether the missing half mattered.
 */

test("text already inside the budget is returned untouched", () => {
  const s = "Varmende trøst på boks. God mot mandagsstemning.";
  assert.ok(s.length <= DESCRIPTION_MAX_CHARS);
  assert.equal(fitDescriptionText(s), s);
});

test("surrounding whitespace is not counted as content", () => {
  assert.equal(fitDescriptionText("  Kort og godt.  "), "Kort og godt.");
});

test("a two-sentence description keeps the sentence that fits", () => {
  // 93 chars — one of the week's real ones, three lines on the card.
  const real =
    "Mørt lammegryte med urter, servert med fyldige kokte poteter. En varmende, rustikk nytelse.";
  const out = fitDescriptionText(real);
  assert.equal(out, "Mørt lammegryte med urter, servert med fyldige kokte poteter.");
  assert.ok(out.length <= DESCRIPTION_MAX_CHARS, `${out.length} > ${DESCRIPTION_MAX_CHARS}`);
  assert.doesNotMatch(out, /…$/, "a complete sentence needs no ellipsis");
});

test("exclamation and question marks end sentences too", () => {
  assert.equal(
    fitDescriptionText("Pølse-følelsen, uten dyrene! Serveres med mos som buffer og litt til."),
    "Pølse-følelsen, uten dyrene!"
  );
  assert.equal(
    fitDescriptionText(
      "Hvem trenger egentlig kjøtt her? Denne retten svarer på spørsmålet med en gang."
    ),
    "Hvem trenger egentlig kjøtt her?"
  );
});

test("a short first sentence loses to the words that would fit instead", () => {
  // "Hvem trenger kjøtt?" is complete, and is 19 characters of a 68-character
  // card. The stub guard prefers the word cut, which fills the two lines and
  // says with an ellipsis that there was more.
  const out = fitDescriptionText(
    "Hvem trenger kjøtt? Denne retten svarer på spørsmålet med en gang, tydelig."
  );
  assert.notEqual(out, "Hvem trenger kjøtt?");
  assert.match(out, /…$/);
  assert.ok(out.length > 40, `the word cut should use the space: got ${out.length} chars`);
});

test("a sentence break too early is ignored rather than leaving a stub", () => {
  // "Nam." fits, but four characters out of 68 wastes the whole card. The word
  // cut is the better answer, and it says so with an ellipsis.
  const out = fitDescriptionText(
    "Nam. En solid gryte som er langt mer spennende enn navnet antyder og verdt turen."
  );
  assert.notEqual(out, "Nam.");
  assert.match(out, /…$/);
  assert.ok(out.length <= DESCRIPTION_MAX_CHARS + 1, `${out.length}`);
});

test("prose with no sentence break in range is cut on a word, never mid-word", () => {
  const long =
    "En solid gryte som er langt mer spennende enn navnet antyder og perfekt for å døyve sulten";
  const out = fitDescriptionText(long);
  assert.match(out, /…$/, "a genuinely unfinished cut says so");
  const body = out.slice(0, -1);
  assert.ok(long.startsWith(body), "the kept text is a prefix of the original");
  assert.ok(
    long[body.length] === " " || long[body.length] === undefined,
    `cut mid-word: "${body}" is followed by ${JSON.stringify(long[body.length])}`
  );
  assert.ok(out.length <= DESCRIPTION_MAX_CHARS + 1, `${out.length}`);
});

test("a dangling comma or dash is not left in front of the ellipsis", () => {
  const out = fitDescriptionText(
    "Torsk som smelter på tungen, med grønnsaker som har sett bedre dager, men smaker godt"
  );
  assert.doesNotMatch(out, /[\s,;:–—-]…$/, `left punctuation dangling: ${out}`);
});

test("every canned fallback fits after trimming", () => {
  // The 18 canned strings run 64-85 characters. They are the last resort for a
  // dish the model never answers for, and they were over budget too.
  const canned = [
    "Chef's special fra kantinens helter. Tilberedt med stolthet og friske råvarer.",
    "Varmende trøst på boks. Garanti mot vestavind og dårlig mandagsstemning.",
    "Nystekt italiensk magi. Kantinens ubestridte stjerne – kom før kollegaene spiser alt.",
    "Karbo-glede på sitt beste. Serveres med nok parmesan til å glemme neste møte.",
    "Langsomt kokt kjærlighet. Så mør og smaksrik at du vurderer porsjon nummer to.",
    "Sprø utside, saftig innside. Gylden lykke som løfter humøret tre hakk.",
    "Saftig proteinkick tilberedt med tradisjon. Kjøkkenets stolthet i dag.",
    "Fersk fangst i gourmetdrakt. Så godt at selv fiskeskeptikere blir omvendt.",
    "Fiesta midt i arbeidsdagen. Litt krydder for å våkne før ettermiddagsøkta.",
  ];
  for (const c of canned) {
    const out = fitDescriptionText(c);
    assert.ok(out.length <= DESCRIPTION_MAX_CHARS + 1, `"${out}" is ${out.length} chars`);
    assert.ok(out.length > 0);
  }
});

test("both languages are trimmed, and a missing one stays missing", () => {
  const out = fitDescription({
    no: "Mørt lammegryte med urter, servert med fyldige kokte poteter. En varmende nytelse.",
    en: "Tender lamb stew with herbs, served with rich boiled potatoes. A warming delight.",
  });
  assert.ok(out.no!.length <= DESCRIPTION_MAX_CHARS + 1);
  assert.ok(out.en!.length <= DESCRIPTION_MAX_CHARS + 1);

  const noEnglish = fitDescription({ no: "Kort og godt." });
  assert.equal(noEnglish.no, "Kort og godt.");
  assert.equal("en" in noEnglish, false, "an absent language is not invented as an empty string");
});

test("the budget is the measured two-line width, not a round number", () => {
  // 69 characters is what two lines hold at 390x844 and 430x932, 72 at 360x740.
  // If this is ever raised above 69 the card starts cutting text off again.
  assert.ok(DESCRIPTION_MAX_CHARS <= 69, "two lines hold 69 characters on the narrowest measured phone");
  assert.ok(DESCRIPTION_MAX_CHARS >= 50, "below this the description stops being worth showing");
});
