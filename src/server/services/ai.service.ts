import { GoogleGenAI } from "@google/genai";
import type { DishOrigin, DishDescription, Recipe } from "../../lib/types.js";

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
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

/** Runs one prompt through the cascade, returning parsed JSON or null. */
async function generateJson<T>(prompt: string, label: string): Promise<T | null> {
  const ai = getAIClient();
  if (!ai) return null;

  for (const model of FLASH_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [{ text: prompt }] },
        config: { responseMimeType: "application/json" },
      });

      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;
      return JSON.parse(text) as T;
    } catch (err: any) {
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
 * Exported because the updater also needs it for dishes it has deliberately
 * stopped asking about (see MAX_ENRICH_ATTEMPTS in dish-cache.service): those
 * never reach a pass, so nothing else would give them a flag.
 */
export function fallbackOrigin(dish: string): DishOrigin {
  const match = ORIGIN_PATTERNS.find((p) => p.regex.test(dish));
  return match ? { code: match.code, country: match.country } : { code: "no", country: "Norway" };
}

/** Canned bilingual copy, keyed off whatever the dish name gives away. */
export function fallbackDescription(dish: string): DishDescription {
  const lower = dish.toLowerCase();
  let noDesc = `Chef's special fra kantinens helter. Tilberedt med stolthet og friske råvarer.`;
  let enDesc = `Chef's special crafted by canteen heroes. Made with pride and fresh ingredients.`;

  if (lower.includes("suppe") || lower.includes("soup")) {
    noDesc = `Varmende trøst på boks. Garanti mot vestavind og dårlig mandagsstemning.`;
    enDesc = `Liquid comfort in a bowl. Scientifically proven to cure Monday morning blues.`;
  } else if (lower.includes("pizza")) {
    noDesc = `Nystekt italiensk magi. Kantinens ubestridte stjerne – kom før kollegaene spiser alt.`;
    enDesc = `Freshly baked crispy perfection. The crown jewel of the canteen floor.`;
  } else if (lower.includes("pasta")) {
    noDesc = `Karbo-glede på sitt beste. Serveres med nok parmesan til å glemme neste møte.`;
    enDesc = `Carb-loaded bliss. Topped with enough parmesan to make your next meeting bearable.`;
  } else if (lower.includes("gryte") || lower.includes("stew") || lower.includes("curry")) {
    noDesc = `Langsomt kokt kjærlighet. Så mør og smaksrik at du vurderer porsjon nummer to.`;
    enDesc = `Slow-cooked culinary magic. So rich and tender you'll secretly contemplate seconds.`;
  } else if (lower.includes("schnitzel") || lower.includes("panert")) {
    noDesc = `Sprø utside, saftig innside. Gylden lykke som løfter humøret tre hakk.`;
    enDesc = `Golden crispy perfection on the outside, pure joy on the inside.`;
  } else if (lower.includes("biff") || lower.includes("beef") || lower.includes("karbonad") || lower.includes("pølse")) {
    noDesc = `Saftig proteinkick tilberedt med tradisjon. Kjøkkenets stolthet i dag.`;
    enDesc = `Hearty protein feast crafted with pride. Today's undisputed hero dish.`;
  } else if (lower.includes("fisk") || lower.includes("fish") || lower.includes("rødspette") || lower.includes("torsk") || lower.includes("laks")) {
    noDesc = `Fersk fangst i gourmetdrakt. Så godt at selv fiskeskeptikere blir omvendt.`;
    enDesc = `Fresh catch done right. So delicious it'll convert even the fiercest fish skeptics.`;
  } else if (lower.includes("taco") || lower.includes("burrito") || lower.includes("tortilla") || lower.includes("meksikansk")) {
    noDesc = `Fiesta midt i arbeidsdagen. Litt krydder for å våkne før ettermiddagsøkta.`;
    enDesc = `A workday fiesta in a tortilla. Just enough spice to revive your post-lunch focus.`;
  }

  return { no: noDesc, en: enDesc };
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
- Describe the dish named, not a different one.
- Return ONLY a JSON object mapping each dish name EXACTLY as given above to bilingual descriptions:
{
  "Dish Name": {
    "no": "Appetizing and quietly witty description in Norwegian (Bokmål)",
    "en": "Appetizing and quietly witty description in English"
  }
}`;

    const parsed = await generateJson<Record<string, DishDescription>>(
      prompt,
      "description generation"
    );
    if (parsed) {
      for (const dish of batch) {
        const entry = parsed[dish];
        if (entry && (entry.no || entry.en)) {
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
  const prompt = `You are a head chef describing how a dish is plated, for a food photographer.

The dish is from a Norwegian workplace canteen. Its menu line is:
"${dishName}"

That line is written by the kitchen and is often a run-on list of components
with no punctuation, sometimes with scraping artefacts or misspellings. Read it
as a chef would and work out what the finished dish actually is.

Reply with ONE English sentence, max 40 words, describing the plated dish:
the main component and how it is cooked, what it is served with, any sauce, and
the dominant colours. Describe a composed, finished plate — the way it leaves a
canteen kitchen.

Rules:
- Name real, cooked food. Never describe raw ingredients laid out separately,
  deconstructed components, or anything written/printed.
- Every main component named in the menu line must appear in your sentence. Do
  not substitute, drop or invent a different dish.
- If the line is ambiguous, choose the most ordinary Norwegian canteen reading.
- No adjectives about taste, no marketing language. Plain visual description.

Return ONLY JSON: {"plating": "..."}`;

  const parsed = await generateJson<{ plating?: string }>(prompt, `plating brief: ${dishName}`);
  const plating = parsed?.plating?.trim();
  return plating ? plating : null;
}

export async function generateAIRecipe(
  dishName: string,
  lang: "no" | "en"
): Promise<Recipe> {
  const ai = getAIClient();

  const langInstruction =
    lang === "no"
      ? "Respond entirely in Norwegian (bokmål)."
      : "Respond entirely in English.";

  const itemLocalField =
    lang === "no"
      ? `\n    { "amount": "4", "unit": "fileter", "item": "Salmon", "itemLocal": "Laks" }`
      : `\n    { "amount": "4", "unit": "fillets", "item": "Salmon" }`;

  const itemLocalRule =
    lang === "no"
      ? `\n- Also include an "itemLocal" field with the Norwegian name for each ingredient.`
      : "";

  const promptText = `You are an expert Scandinavian chef with a touch of culinary wit. Generate a home recipe for: "${dishName}".

${langInstruction}

Return ONLY valid JSON:
{
  "title": "${dishName}",
  "servings": 4,
  "prepTime": "20 min",
  "cookTime": "30 min",
  "ingredients": [${itemLocalField}
  ],
  "steps": [
    "Step 1 instruction...",
    "Step 2 instruction..."
  ],
  "tip": "Useful and witty cooking tip"
}${itemLocalRule}`;

  if (ai) {
    for (const model of FLASH_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text: promptText }] },
          config: { responseMimeType: "application/json" },
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return JSON.parse(text) as Recipe;
        }
      } catch (err) {
        console.warn(`Model ${model} failed for recipe generation, trying next model...`);
      }
    }
  }

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
      lang === "no" ? "Forbered ingrediensene og varm opp pannen eller gryten." : "Prepare the ingredients and heat the pan or pot.",
      lang === "no" ? `Tilbered ${dishName} over middels varme til det er gjennomvarmt og saftig.` : `Cook ${dishName} over medium heat until tender and well combined.`,
      lang === "no" ? "Server varmt med friskt tilbehør." : "Serve hot with fresh sides.",
    ],
    tip: lang === "no" ? "Server med et smil og et ekstra dryss kjærlighet!" : "Serve with a smile and an extra sprinkle of love!",
  };
}
