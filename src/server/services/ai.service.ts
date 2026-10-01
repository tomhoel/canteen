import { GoogleGenAI } from "@google/genai";
import { DISH_COURSES } from "../../lib/types.js";
import type { DishOrigin, DishDescription, DishCourse, Recipe } from "../../lib/types.js";
// Lives in its own module so /api/menu can trim descriptions without booting
// this file's 14 MB of model SDK. See fit-description.ts.
import { DESCRIPTION_MAX_CHARS } from "./fit-description.js";

let client: { key: string; ai: GoogleGenAI } | undefined;

/** The one Gemini client (also used for plate images), built once per key. */
export function getAIClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (client?.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

/** No call may hold the run longer than this; the cron has 300s in total. */
const AI_TEXT_TIMEOUT_MS = 30_000;
/** A model that just failed is skipped for this long (a warm instance keeps module state). */
const MODEL_COOLDOWN_MS = 10 * 60 * 1000;
const modelFailedAt = new Map<string, number>();

/** The cascade without the models that failed recently; all of it if every one did. */
function liveModels(): string[] {
  const now = Date.now();
  const live = FLASH_MODELS.filter((m) => now - (modelFailedAt.get(m) ?? 0) > MODEL_COOLDOWN_MS);
  return live.length ? live : FLASH_MODELS;
}

/**
 * Model cascade for the text calls, in preference order. These are the models
 * the previous pipeline ran against in production; the earlier v2 list
 * included gemini-1.5-flash, which is retired and fails every call.
 */
const FLASH_MODELS = [
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
];

/**
 * Dishes per request. A full week is ~100 distinct dishes across both
 * languages; asking for all of them in one shot produces a long JSON reply
 * that gets truncated, and a truncated reply fails JSON.parse and throws away
 * every dish in the batch. Smaller batches also mean one bad batch degrades to
 * the pattern fallback on its own rather than for the whole week.
 */
const BATCH_SIZE = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs one prompt through the cascade, returning parsed JSON or null.
 *
 * Every call has a timeout, and a model that errors is skipped for the next ten
 * minutes: with the preview model down, each of the ~10 batches in a run used to
 * pay for one failed call before reaching the model that works, and a hung call
 * could hold the whole run until the 300s kill.
 */
async function generateJson<T>(prompt: string, label: string): Promise<T | null> {
  const ai = getAIClient();
  if (!ai) return null;

  for (const model of liveModels()) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json", abortSignal: AbortSignal.timeout(AI_TEXT_TIMEOUT_MS) },
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      const parsed = JSON.parse(text) as T;
      modelFailedAt.delete(model);
      return parsed;
    } catch (err: any) {
      modelFailedAt.set(model, Date.now());
      console.warn(`Model ${model} failed for ${label}: ${err?.message ?? err}`);
    }
  }
  return null;
}

// Smart pattern-based fallback origin detection when AI API key is not present or rate limited
const ORIGIN_PATTERNS: Array<{ regex: RegExp; code: string; country: string }> = [
  { regex: /tandoori|tikka|masala|curry|indisk|naan/i, code: "in", country: "India" },
  { regex: /pizza|pasta|bolognese|carbonara|risotto|parmesan|lasagne|lasagna/i, code: "it", country: "Italy" },
  { regex: /taco|tortilla|burrito|chili sin carne|meksikansk|mexican|salsa/i, code: "mx", country: "Mexico" },
  { regex: /gyros|tzatziki|gresk|greek|souvlaki/i, code: "gr", country: "Greece" },
  { regex: /schnitzel/i, code: "at", country: "Austria" },
  { regex: /coq au vin|fransk|french onion|bearnaise|bordeaux/i, code: "fr", country: "France" },
  { regex: /teriyaki|ramen|sushi|tempura|japansk|japanese/i, code: "jp", country: "Japan" },
  { regex: /pad thai|tom yum|thailandsk|thai/i, code: "th", country: "Thailand" },
  { regex: /stekt ris|fried rice|wok|dim sum|kinesisk|chinese|sweet and sour/i, code: "cn", country: "China" },
  { regex: /falafel|hummus|kebab|shakshuka|libanesisk/i, code: "lb", country: "Lebanon" },
  { regex: /buffalo|burger|bbq|barbados|wings/i, code: "us", country: "United States" },
  { regex: /stroganoff|gulasj|goulash/i, code: "hu", country: "Hungary" },
  { regex: /fiskesuppe|karbonader|kjøttkaker|norsk|betasuppe|elg|potet/i, code: "no", country: "Norway" },
];

/**
 * Pattern-based origin, used for anything the model didn't cover.
 *
 * Exported because the updater also needs it for dishes the model did not
 * answer for this run, which render a flag until a later run gets an answer.
 */
export function fallbackOrigin(dish: string): DishOrigin {
  const match = ORIGIN_PATTERNS.find((p) => p.regex.test(dish));
  return match ? { code: match.code, country: match.country } : { code: "no", country: "Norway" };
}

/** Canned Norwegian copy, keyed off whatever the dish name gives away. */
export function fallbackDescription(dish: string): DishDescription {
  const lower = dish.toLowerCase();
  let noDesc = `Chef's special fra kantinens helter. Tilberedt med stolthet og friske råvarer.`;

  if (lower.includes("suppe") || lower.includes("soup")) {
    noDesc = `Varmende trøst på boks. Garanti mot vestavind og dårlig mandagsstemning.`;
  } else if (lower.includes("pizza")) {
    noDesc = `Nystekt italiensk magi. Kantinens ubestridte stjerne – kom før kollegaene spiser alt.`;
  } else if (lower.includes("pasta")) {
    noDesc = `Karbo-glede på sitt beste. Serveres med nok parmesan til å glemme neste møte.`;
  } else if (lower.includes("gryte") || lower.includes("stew") || lower.includes("curry")) {
    noDesc = `Langsomt kokt kjærlighet. Så mør og smaksrik at du vurderer porsjon nummer to.`;
  } else if (lower.includes("schnitzel") || lower.includes("panert")) {
    noDesc = `Sprø utside, saftig innside. Gylden lykke som løfter humøret tre hakk.`;
  } else if (lower.includes("biff") || lower.includes("beef") || lower.includes("karbonad") || lower.includes("pølse")) {
    noDesc = `Saftig proteinkick tilberedt med tradisjon. Kjøkkenets stolthet i dag.`;
  } else if (lower.includes("fisk") || lower.includes("fish") || lower.includes("rødspette") || lower.includes("torsk") || lower.includes("laks")) {
    noDesc = `Fersk fangst i gourmetdrakt. Så godt at selv fiskeskeptikere blir omvendt.`;
  } else if (lower.includes("taco") || lower.includes("burrito") || lower.includes("tortilla") || lower.includes("meksikansk")) {
    noDesc = `Fiesta midt i arbeidsdagen. Litt krydder for å våkne før ettermiddagsøkta.`;
  }

  return { no: noDesc };
}

/**
 * An enrichment pass plus the provenance of each entry.
 *
 * Both passes below guarantee full coverage by filling gaps with a pattern
 * fallback, which is right for rendering — no dish should show up blank — but
 * wrong to persist: a rate-limited run would otherwise write canned copy into
 * dish_cache, where it is reused forever and never retried. Callers that cache
 * must consult `fromModel` and store only those.
 */
export interface EnrichmentPass<T> {
  values: Record<string, T>;
  /** Dishes the model actually answered for; the rest are fallbacks. */
  fromModel: Set<string>;
}

export async function detectDishOrigins(
  dishes: string[]
): Promise<EnrichmentPass<DishOrigin>> {
  if (dishes.length === 0) return { values: {}, fromModel: new Set() };

  const result: Record<string, DishOrigin> = {};
  const fromModel = new Set<string>();

  for (const batch of chunk(dishes, BATCH_SIZE)) {
    const prompt = `Analyze these dish names and determine their culinary origin country.
Every dish MUST have a country origin. If a dish is a general Scandinavian/Norwegian canteen dish, classify it as Norway (code: "no", country: "Norway").

${batch.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Return ONLY a JSON object mapping each dish name EXACTLY as given above to its origin:
{
  "Dish Name": { "code": "2-letter ISO country code e.g. it, fr, th, mx, no", "country": "English Country Name" }
}`;

    const parsed = await generateJson<Record<string, DishOrigin>>(prompt, "origin detection");
    if (parsed) {
      for (const dish of batch) {
        const entry = parsed[dish];
        if (entry?.code && entry?.country) {
          result[dish] = entry;
          fromModel.add(dish);
        }
      }
    }
  }

  // Guarantee full coverage: anything the model skipped, renamed or dropped
  // still gets an origin, so no dish renders without a flag.
  for (const dish of dishes) {
    if (!result[dish]) result[dish] = fallbackOrigin(dish);
  }

  return { values: result, fromModel };
}

export async function generateDishDescriptions(
  dishes: string[]
): Promise<EnrichmentPass<DishDescription>> {
  if (dishes.length === 0) return { values: {}, fromModel: new Set() };

  const result: Record<string, DishDescription> = {};
  const fromModel = new Set<string>();

  for (const batch of chunk(dishes, BATCH_SIZE)) {
    const prompt = `Generate witty, mouth-watering, and quietly funny 1-2 sentence descriptions for these canteen dishes:

${batch.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Guidelines:
- Make them sound delicious with subtle Scandinavian/workday humor, light sarcasm, or gourmet chef flair.
- SPACE IS THE HARD CONSTRAINT. Each description is printed on a phone card in a
  column about 34 characters wide, and it gets exactly two lines. That is
  ${DESCRIPTION_MAX_CHARS} characters INCLUDING spaces and punctuation. Anything longer is cut off
  mid-sentence on the card, so a shorter description is always better than a
  truncated one.
- Write ONE short sentence, or two very short ones, and count the characters.
- Do not end with an ellipsis; finish the thought inside the budget.
- Describe the dish named, not a different one.
- Return ONLY a JSON object mapping each dish name EXACTLY as given above to a Norwegian (Bokmål) description of at most ${DESCRIPTION_MAX_CHARS} characters:
{
  "Dish Name": {
    "no": "Appetizing and quietly witty description in Norwegian (Bokmål)"
  }
}`;

    const parsed = await generateJson<Record<string, DishDescription>>(
      prompt,
      "description generation"
    );
    if (parsed) {
      for (const dish of batch) {
        const entry = parsed[dish];
        if (entry?.no) {
          result[dish] = entry;
          fromModel.add(dish);
        }
      }
    }
  }

  // Any dish the model skipped falls back to the canned copy, so every dish
  // carries a description rather than rendering blank.
  for (const dish of dishes) {
    if (!result[dish]) result[dish] = fallbackDescription(dish);
  }

  return { values: result, fromModel };
}

/**
 * Labels each dish with the course it is, for choosing the day's headline dish.
 *
 * Only labels the model actually returned, and only values from the closed
 * set, come back; the caller stores those and leaves the rest to the name
 * rules in dish-ranking. A label is cached for good, so the prompt spells out
 * the edge cases rather than leave them to the model's mood.
 */
export async function classifyCourses(dishes: string[]): Promise<Record<string, DishCourse>> {
  const out: Record<string, DishCourse> = {};
  if (dishes.length === 0) return out;

  for (const batch of chunk(dishes, BATCH_SIZE * 2)) {
    const prompt = `You are classifying dishes from a Norwegian office canteen menu. For each dish choose exactly one course label:

- "meat_plate": meat, poultry or fish/seafood served as a plated main with sides (steak, roast, fish fillet, schnitzel, meatballs or sausages with potatoes, fish and chips, tandoori chicken with rice, baked cod).
- "meat_mixed": a hot dish where meat or fish is mixed into the dish rather than sitting on a plate (wok, pasta, stew/gryte, curry, stroganoff, lasagne, burger, tacos, jambalaya, stir-fry with chicken).
- "veg": a vegetarian or vegan hot dish, including porridge, bean or lentil dishes, vegetarian curry, falafel, vegetable bakes.
- "soup": any soup, including meat or fish soups.
- "side": pizza, salad, bread, dessert, plain rice or other sides, anything that is not a main dish.

Rules:
- Judge by the dish name only. The name is usually Norwegian.
- A soup is always "soup", even if it names meat or fish.
- Pizza is always "side".
- If it names meat or fish and is a stew, wok, pasta or curry, it is "meat_mixed"; if it is served with potatoes, rice or vegetables as separate components, it is "meat_plate".

${batch.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Return ONLY a JSON object mapping each dish name EXACTLY as given above to its label:
{ "Dish Name": "meat_plate" }`;

    const parsed = await generateJson<Record<string, string>>(prompt, "course classification");
    if (!parsed) continue;
    for (const dish of batch) {
      const label = parsed[dish];
      if ((DISH_COURSES as readonly string[]).includes(label)) out[dish] = label as DishCourse;
    }
  }
  return out;
}

/**
 * Levenshtein distance, with an early bail-out.
 *
 * Both title validators below need it, and the `> 6` shortcut is load-bearing
 * for the proofreader: it only ever accepts distances up to 3, so any pair
 * whose lengths differ by more than 6 is already a reject and there is no point
 * filling the table.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 6) return 7;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Validates a proposed AI title correction against safety heuristics.
 * Rejects translations and wholesale rewrites, accepting only compound fixes,
 * small typo corrections, and high-overlap edits.
 */
export function validateTitleCorrection(original: string, corrected: string): boolean {
  if (typeof corrected !== "string" || !corrected.trim() || corrected.trim() === original.trim()) {
    return false;
  }

  const cleanOrig = original.trim();
  const cleanCorr = corrected.trim();

  const stripNonLetters = (s: string) => s.toLowerCase().replace(/[^a-zæøåäöü0-9]/gi, "");

  const strippedOrig = stripNonLetters(cleanOrig);
  const strippedCorr = stripNonLetters(cleanCorr);

  // 1. Compound-word fix: same letters, only whitespace/punctuation merged
  if (strippedOrig === strippedCorr) {
    return true;
  }

  // 2. Hard reject: Norwegian-only characters dropped (likely English translation)
  const hadNoChar = /[æøåÆØÅ]/.test(cleanOrig);
  const stillHasNoChar = /[æøåÆØÅ]/.test(cleanCorr);
  if (hadNoChar && !stillHasNoChar) {
    return false;
  }

  // 3. Small typo / combined compound fix: low edit distance on full string or stripped string
  if (
    editDistance(cleanOrig.toLowerCase(), cleanCorr.toLowerCase()) <= 3 ||
    editDistance(strippedOrig, strippedCorr) <= 3
  ) {
    return true;
  }

  // 4. Multi-word: require significant word/token overlap (>= 50%)
  const origWords = cleanOrig.toLowerCase().split(/\s+/).filter(Boolean);
  const newWords = cleanCorr.toLowerCase().split(/\s+/).filter(Boolean);
  let matched = 0;
  for (const ow of origWords) {
    if (
      newWords.some(
        (nw) => nw === ow || editDistance(ow, nw) <= 2 || nw.includes(ow) || ow.includes(nw)
      )
    ) {
      matched++;
    }
  }
  const denom = Math.max(origWords.length, newWords.length) || 1;
  return matched / denom >= 0.5;
}

/**
 * Proofreads Norwegian dish titles using Gemini to fix typos, compound words,
 * and capitalization errors. Conservative validation rejects translations
 * and wholesale rewrites.
 *
 * `answered` is every title in a batch the model replied to, whether or not it
 * changed anything. A reply of `{}` means "these are fine", which is a different
 * thing from a call that failed, and only the first is worth remembering.
 */
export async function cleanDishTitles(
  dishes: string[]
): Promise<{ corrections: Record<string, string>; answered: Set<string> }> {
  const result: Record<string, string> = {};
  const answered = new Set<string>();
  if (dishes.length === 0) return { corrections: result, answered };

  for (const batch of chunk(dishes, BATCH_SIZE)) {
    const prompt = `You are a proofreader for a Norwegian workplace canteen menu. The titles below were scraped from a website and may contain errors.

Fix ONLY these types of issues in Norwegian dish names:
- Typos (e.g. "Ppork" → "Pork", "wiith" → "with", "ruccula" → "rucola", "grgrønnsaker" → "grønnsaker")
- Norwegian compound words that must be joined (e.g. "tomat suppe" → "tomatsuppe", "karri saus" → "karrisaus", "sitron potet" → "sitronpotet", "pasta grateng" → "pastagrateng")
- Capitalization errors (e.g. "Bbq" → "BBQ", random mid-word capitals)
- Duplicate words (e.g. "og og ris" → "og ris")
- Obviously missing small words (e.g. "Kikertgryte ris" → "Kikertgryte med ris")

CRITICAL RULES:
- Be CONSERVATIVE. Only fix clear, obvious errors.
- Do NOT rephrase, rewrite, or improve wording.
- Do NOT translate between Norwegian and English (keep Norwegian text in Norwegian).
- Do NOT change dish names, cooking terms, or foreign words that are intentional (e.g. keep "Stracotta", "jalfrezi", "Dan Dan" as-is).
- Do NOT change the overall structure or word order.
- If a title has no errors, do NOT include it in the output.

Titles to proofread:
${batch.map((d, i) => `${i + 1}. "${d}"`).join("\n")}

Respond with ONLY a JSON object containing entries where corrections were made.
Format: {"original title": "corrected title"}
If nothing needs fixing, respond with {}`;

    const parsed = await generateJson<Record<string, string>>(
      prompt,
      "dish title proofreading"
    );

    if (parsed && typeof parsed === "object") {
      const batchSet = new Set(batch);
      for (const original of batch) answered.add(original);
      for (const [original, corrected] of Object.entries(parsed)) {
        if (batchSet.has(original) && validateTitleCorrection(original, corrected)) {
          result[original] = corrected.trim();
        }
      }
    }
  }

  return { corrections: result, answered };
}

/**
 * How long a dish title may be before the card has to wrap it onto a third
 * line, and the hard ceiling past which it is cut off entirely.
 *
 * Measured, not guessed. On a 390x844 phone the headline column is 197.6px of
 * usable width at a 15.2px bold face, which is a little over 25 characters a
 * line. Two lines is what the card is budgeted for: the plate is 160px tall
 * and the ANDRE RETTER block below it takes the rest, so a title that runs to
 * three lines eats the description's only line.
 *
 * TARGET is what the model is asked to hit. MAX is what the validator will
 * still accept — a title between the two costs a third line but is not
 * truncated, which is better than rejecting a good shortening for two
 * characters. Anything longer is refused and the original is kept, because a
 * title the card cuts off is no worse than one the model mangled.
 */
export const SHORT_TITLE_TARGET_CHARS = 48;
export const SHORT_TITLE_MAX_CHARS = 62;

/**
 * A shortening pass, plus the dishes the model actually gave an answer about.
 *
 * `fromModel` alone cannot distinguish "the model looked at this title and had
 * nothing shorter" from "the call never landed". The caller needs to, because
 * the first is worth recording permanently so the dish is never re-sent, and
 * the second must stay retryable — one rate-limited afternoon would otherwise
 * mark a whole week's titles unshortenable forever.
 */
export interface ShortTitlePass extends EnrichmentPass<string> {
  answered: Set<string>;
}

/** Whether a dish name is long enough to be worth a model call. */
export function needsShortening(dish: string): boolean {
  return dish.trim().length > SHORT_TITLE_TARGET_CHARS;
}

/**
 * Accepts a shortened title only if it is a TRIM of the original, never a
 * rewrite.
 *
 * This is the safety property that matters. The short title is what the card
 * shows, so a model that invents "Kylling med ris" for a fish dish puts a wrong
 * dish in front of someone deciding where to eat. Requiring every word of the
 * short title to appear in the original makes that impossible: the model may
 * only drop words, not supply them.
 *
 * The word match is deliberately loose about form — Norwegian compounds get
 * split and joined freely ("sitronpotet" / "sitron potet"), and inflections
 * differ by a letter or two ("poteter" / "potet") — so a word counts as present
 * if it contains, is contained by, or is within two edits of some word of the
 * original.
 */
export function validateShortTitle(original: string, short: string): boolean {
  if (typeof short !== "string") return false;

  const cleanOrig = original.trim();
  const cleanShort = short.trim();

  if (!cleanShort) return false;
  // No gain, or worse: not worth a cache row.
  if (cleanShort.length >= cleanOrig.length) return false;
  if (cleanShort.length > SHORT_TITLE_MAX_CHARS) return false;

  const words = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-zæøåäöü0-9\s-]/gi, " ")
      .split(/[\s-]+/)
      .filter(Boolean);

  const origWords = words(cleanOrig);
  const shortWords = words(cleanShort);
  if (shortWords.length === 0) return false;

  const known = (w: string) =>
    origWords.some(
      (ow) => ow === w || ow.includes(w) || w.includes(ow) || editDistance(ow, w) <= 2
    );

  // Every word must come from the original. One invented word is a reject.
  if (!shortWords.every(known)) return false;

  // And enough of the original must survive that it still names the dish.
  // "Laks" alone is technically a trim of "Bakt laks med sitronpotet" and is
  // not a title.
  const contentWords = shortWords.filter((w) => w.length > 2);
  return contentWords.length >= 2;
}

/**
 * Shortens dish titles that are too long for the card's headline.
 *
 * Kept separate from cleanDishTitles, and from the dish name itself, on
 * purpose. The scraped name is the primary key of dish_cache, the name a plate
 * image is archived under, and what the recipe generator is asked about;
 * rewriting it in place would change those keys and orphan every plate already
 * drawn for that dish. So this is a display-only field, and the full name is
 * still what the lightbox and the recipe show.
 *
 * Like the other passes it reports `fromModel`, so a rate-limited run writes
 * nothing to the cache rather than persisting a title it did not get.
 */
export async function shortenDishTitles(
  dishes: string[]
): Promise<ShortTitlePass> {
  if (dishes.length === 0) {
    return { values: {}, fromModel: new Set(), answered: new Set() };
  }

  const result: Record<string, string> = {};
  const fromModel = new Set<string>();
  const answered = new Set<string>();

  for (const batch of chunk(dishes, BATCH_SIZE)) {
    const prompt = `You are editing headlines for a Norwegian workplace canteen app.

Each title below is printed on a phone card in a column about 25 characters
wide. Two lines is the space available — roughly ${SHORT_TITLE_TARGET_CHARS}
characters. These titles are longer than that and need to be shortened.

Shorten each one to at most ${SHORT_TITLE_TARGET_CHARS} characters by REMOVING
words. Keep the dish recognisable at a glance.

RULES:
- Only DELETE words. Never add a word that is not already in the title, never
  substitute a synonym, never translate, never re-order.
- Keep the main component: the protein or the dish itself, and the one side
  that identifies it. Drop trailing garnishes, dressings, preparation adverbs
  and "serveres med ..." clauses first.
- Keep the original spelling and casing of every word you keep, including
  Norwegian characters (æ ø å).
- Do not add a trailing ellipsis, period, or any punctuation of your own.
- If a title cannot be shortened without losing what the dish is, omit it from
  the output entirely.

Examples:
"Bakt laks med stekt sitronpotet, rucola og ajvardressing" -> "Bakt laks med sitronpotet og rucola"
"Tortilla med skavet kyllinglårfilet, serveres med hvitløksdressing eller salsa" -> "Tortilla med skavet kyllinglårfilet"
"Ovnsbakt torskefilet med rattatouille og saltbakte poteter" -> "Ovnsbakt torskefilet med poteter"

Titles to shorten:
${batch.map((d, i) => `${i + 1}. "${d}"`).join("\n")}

Respond with ONLY a JSON object mapping each ORIGINAL title exactly as given
above to its shortened form. Omit any title you could not shorten safely.
Format: {"original title": "shortened title"}`;

    const parsed = await generateJson<Record<string, string>>(prompt, "dish title shortening");

    if (parsed && typeof parsed === "object") {
      // The call landed and returned something parseable, so every title in
      // this batch has now had its answer — including the ones the model chose
      // to omit. That is what lets the caller store a "nothing shorter exists"
      // marker for them without also marking dishes whose call never arrived.
      for (const dish of batch) answered.add(dish);

      const batchSet = new Set(batch);
      for (const [original, short] of Object.entries(parsed)) {
        if (batchSet.has(original) && validateShortTitle(original, short)) {
          result[original] = short.trim();
          fromModel.add(original);
        }
      }
    }
  }

  // No fallback here, unlike origins and descriptions. A dish with no short
  // title renders its full name, which is correct — there is nothing canned to
  // put in its place.
  return { values: result, fromModel, answered };
}

/**
 * Turns a canteen menu line into a short brief describing the dish as it would
 * arrive on a plate.
 *
 * The image model is given the dish name, and the names the kitchens write are
 * run-on ingredient lists in Norwegian — "Ovnsform storfekjøttdeig med
 * potetgrateng", "Pølsesnadder med chorizo kjøttpølse creme fraiche estragon og
 * hjemmelaget potetmos". Handed that directly, an image model illustrates the
 * *words*: every noun rendered separately, raw components in heaps, sometimes
 * the text itself. The result is recognisably about the right ingredients and
 * not recognisably a meal.
 *
 * Resolving that ambiguity is a language problem, so it is solved in language
 * before any pixels exist. One cheap text call converts the menu line into what
 * a kitchen would actually serve, and the image model is asked to photograph
 * *that*. It runs only when a plate is genuinely being drawn — which the
 * dish-addressed archive already makes rare — so it costs a text call per new
 * dish, alongside an image call that is orders of magnitude more expensive.
 *
 * Returns null if the model is unavailable, in which case the caller falls back
 * to naming the dish alone.
 */
export async function generatePlatingBrief(dishName: string): Promise<string | null> {
  const prompt = `You are an expert executive chef describing how a complete, beautifully composed dish is plated for professional food photography.

The dish is from a Norwegian workplace canteen menu. The kitchen's raw menu line is:
"${dishName}"

That line is written by the kitchen and is often a run-on list of components, a dish title, or fragmented ingredients. Read it as a seasoned chef and determine the authentic, finished culinary meal.

Reply with ONE English sentence, max 45 words, describing the finished plated dish:
- Describe a cohesive, complete single-serving meal as served in a high-quality canteen/bistro.
- Name the cooked main protein/element (how it is prepared, seared, roasted, braised, etc.), how the sauce/dressing is paired with it, and the accompanying cooked sides (e.g. potatoes, rice, steamed/roasted vegetables) plus subtle fresh garnishes (like herbs or lemon wedge) that naturally complete this specific dish.
- Do NOT invent unmentioned meat/fish/mains, but ensure the plate feels like a complete, balanced, harmonious meal rather than disconnected raw or separate piles.
- No adjectives about taste or marketing hype. Plain, vivid visual description of real cooked food.

Return ONLY JSON: {"plating": "..."}`;

  const parsed = await generateJson<{ plating?: string }>(prompt, `plating brief: ${dishName}`);
  const plating = parsed?.plating?.trim();
  return plating ? plating : null;
}

export async function generateAIRecipe(dishName: string): Promise<Recipe> {
  const promptText = `You are an expert Scandinavian chef with a touch of culinary wit. Generate a home recipe for: "${dishName}".

Respond entirely in Norwegian (bokmål).

Return ONLY valid JSON:
{
  "title": "${dishName}",
  "servings": 4,
  "prepTime": "20 min",
  "cookTime": "30 min",
  "ingredients": [
    { "amount": "4", "unit": "fileter", "item": "Salmon", "itemLocal": "Laks" }
  ],
  "steps": [
    "Step 1 instruction...",
    "Step 2 instruction..."
  ],
  "tip": "Useful and witty cooking tip"
}
Also include an "itemLocal" field with the Norwegian name for each ingredient.`;

  const recipe = await generateJson<Recipe>(promptText, `recipe: ${dishName}`);
  if (recipe) return recipe;

  // Fallback recipe structure
  return {
    title: dishName,
    servings: 4,
    prepTime: "15 min",
    cookTime: "25 min",
    ingredients: [
      { amount: "500", unit: "g", item: dishName, itemLocal: dishName },
      { amount: "2", unit: "ss", item: "Olive oil", itemLocal: "Olivenolje" },
      { amount: "1", unit: "klype", item: "Salt and pepper", itemLocal: "Salt og pepper" },
    ],
    steps: [
      "Forbered ingrediensene og varm opp pannen eller gryten.",
      `Tilbered ${dishName} over middels varme til det er gjennomvarmt og saftig.`,
      "Server varmt med friskt tilbehør.",
    ],
    tip: "Server med et smil og et ekstra dryss kjærlighet!",
  };
}
