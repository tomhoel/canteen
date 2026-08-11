import { GoogleGenAI } from "@google/genai";
import type { DishOrigin, DishDescription, Recipe } from "@/lib/types";

function getAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

// Model cascade: try fast & free models in order
const FLASH_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

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

export async function detectDishOrigins(
  dishes: string[]
): Promise<Record<string, DishOrigin>> {
  if (dishes.length === 0) return {};
  const ai = getAIClient();

  if (ai) {
    const prompt = `Analyze these dish names and determine their culinary origin country.
Every dish MUST have a country origin. If a dish is a general Scandinavian/Norwegian canteen dish, classify it as Norway (code: "no", country: "Norway").

${dishes.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Return ONLY a JSON object mapping each dish name to its origin:
{
  "Dish Name": { "code": "2-letter ISO country code e.g. it, fr, th, mx, no", "country": "English Country Name" }
}`;

    for (const model of FLASH_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text: prompt }] },
          config: { responseMimeType: "application/json" },
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return JSON.parse(text) as Record<string, DishOrigin>;
        }
      } catch (err) {
        console.warn(`Model ${model} failed for origin detection, trying next model in cascade...`);
      }
    }
  }

  // Fallback pattern matching — defaults to Norway for 100% dish coverage
  const result: Record<string, DishOrigin> = {};
  for (const dish of dishes) {
    const match = ORIGIN_PATTERNS.find((p) => p.regex.test(dish));
    if (match) {
      result[dish] = { code: match.code, country: match.country };
    } else {
      result[dish] = { code: "no", country: "Norway" };
    }
  }
  return result;
}

export async function generateDishDescriptions(
  dishes: string[]
): Promise<Record<string, DishDescription>> {
  if (dishes.length === 0) return {};
  const ai = getAIClient();

  if (ai) {
    const prompt = `Generate witty, mouth-watering, and quietly funny 1-2 sentence descriptions for these canteen dishes:

${dishes.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Guidelines:
- Make them sound delicious with subtle Scandinavian/workday humor, light sarcasm, or gourmet chef flair.
- Return ONLY a JSON object mapping each dish name to bilingual descriptions:
{
  "Dish Name": {
    "no": "Appetizing and quietly witty description in Norwegian (Bokmål)",
    "en": "Appetizing and quietly witty description in English"
  }
}`;

    for (const model of FLASH_MODELS) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: { parts: [{ text: prompt }] },
          config: { responseMimeType: "application/json" },
        });

        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return JSON.parse(text) as Record<string, DishDescription>;
        }
      } catch (err) {
        console.warn(`Model ${model} failed for description generation, trying next model...`);
      }
    }
  }

  // Enriched, quietly witty fallback description generator for Scandinavian canteen dishes
  const result: Record<string, DishDescription> = {};
  for (const dish of dishes) {
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

    result[dish] = { no: noDesc, en: enDesc };
  }

  return result;
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
