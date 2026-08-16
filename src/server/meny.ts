import { GoogleGenAI } from "@google/genai";
import type {
  RecipeIngredient,
  MenyProduct,
  MenyIngredientMatch,
  MenyResponse,
} from "../lib/types.js";
import { getWeekNumber } from "../lib/dateUtils.js";
import { getRedis } from "./services/redis.service.js";

const MENY_STORE_ID = process.env.MENY_DEFAULT_STORE_ID || "7080001150488";
const MENY_STORE_NAME = "MENY Bryn";

interface GeminiTranslation {
  ingredient: string;
  searchTerm: string;
  fallbackTerm: string;
  pantryStaple: boolean;
}

async function translateIngredients(
  ingredients: RecipeIngredient[],
  dishName: string
): Promise<GeminiTranslation[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const ai = new GoogleGenAI({ apiKey });
  const ingredientList = ingredients
    .map((i) => `${i.amount} ${i.unit} ${i.item}`)
    .join("\n");

  const prompt = `You are a Norwegian grocery shopping assistant. Given this recipe "${dishName}" with these ingredients:

${ingredientList}

Translate ALL ingredients to Norwegian product search terms for Meny.no grocery store.

Return ONLY a JSON array with one entry per ingredient:
[
  { "ingredient": "Original ingredient name", "searchTerm": "specific norwegian product name", "fallbackTerm": "broader fallback if specific not found", "pantryStaple": false }
]

Rules for searchTerm:
- Use the EXACT product name as it appears on a Norwegian grocery store shelf
- Be SPECIFIC: "kyllingfilet" not "kylling", "kjøttdeig" not "kjøtt"
- Use singular form and lowercase
- One search term per ingredient`;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: { parts: [{ text: prompt }] },
    config: { responseMimeType: "application/json" },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No response from Gemini");

  return JSON.parse(text) as GeminiTranslation[];
}

interface MenyApiHit {
  contentId: string;
  title: string;
  description: string;
  imageId: string;
  contentData: {
    _score: number;
    _source: {
      ean: string;
      title: string;
      subtitle: string;
      brand: string;
      pricePerUnit: number;
      comparePricePerUnit: number;
      compareUnit: string;
      weight: number;
      unit: string;
      imagePath: string;
      isOutOfStock: boolean;
      slugifiedUrl: string;
      categoryName: string;
      shoppingListGroupName: string;
    };
  };
}

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.\-/]+/)
    .filter((w) => w.length >= 3);
}

function isRelevantProduct(hit: MenyApiHit, searchTerm: string): boolean {
  const src = hit.contentData._source;
  const productText = `${src.title} ${src.subtitle || ""} ${
    src.categoryName || ""
  } ${src.shoppingListGroupName || ""}`.toLowerCase();
  const termWords = extractWords(searchTerm);
  const termLower = searchTerm.toLowerCase().replace(/[\s-]/g, "");

  if (productText.includes(termLower)) return true;
  const titleLower = src.title.toLowerCase();
  if (
    termLower.length >= 4 &&
    titleLower.includes(
      termLower.slice(0, Math.max(4, Math.floor(termLower.length * 0.6)))
    )
  )
    return true;
  if (termWords.some((w) => titleLower.includes(w))) return true;

  return false;
}

interface MenyApiResponse {
  hits: {
    hits: MenyApiHit[];
  };
}

async function searchMenyApi(
  term: string,
  storeId: string
): Promise<MenyApiHit[]> {
  const url = `https://platform-rest-prod.ngdata.no/api/episearch/1300/products?search=${encodeURIComponent(
    term
  )}&page_size=10&store_id=${storeId}&full_response=true`;

  const res = await fetch(url, {
    headers: {
      "fwc-chain-id": "1300",
      Origin: "https://meny.no",
      Referer: "https://meny.no/",
      "User-Agent": "Mozilla/5.0",
    },
  });

  if (!res.ok) return [];
  const data = (await res.json()) as MenyApiResponse;
  return data.hits?.hits || [];
}

function mapHitToProduct(hit: MenyApiHit): MenyProduct {
  const src = hit.contentData._source;
  const comparePrice = src.comparePricePerUnit;
  const compareUnit = src.compareUnit;

  return {
    ean: src.ean || hit.contentId,
    name: src.title,
    subtitle: src.subtitle || hit.description || "",
    brand: src.brand || "",
    price: src.pricePerUnit,
    pricePerUnit:
      comparePrice && compareUnit
        ? `${comparePrice.toFixed(2).replace(".", ",")} kr/${compareUnit}`
        : null,
    imageUrl: `https://bilder.ngdata.no/${src.ean}/meny/large.jpg`,
    weight: src.weight ? `${src.weight} ${src.compareUnit || "kg"}` : null,
    productUrl: src.slugifiedUrl
      ? `https://meny.no/varer${src.slugifiedUrl}`
      : null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MenySearchPayload {
  ingredients: RecipeIngredient[];
  dishName: string;
  lang?: string;
  storeId?: string;
}

export async function searchMeny(data: MenySearchPayload): Promise<MenyResponse> {
  const { ingredients, dishName, storeId } = data;
  if (!ingredients || !dishName) {
    throw new Error("Invalid request");
  }
  // Not a crash here as it is in deals.ts — this one interpolates the name into
  // a prompt, so a missing `item` searches meny.no for the literal string
  // "undefined" and pays the model to translate it first. Same contract, so the
  // same refusal.
  if (!Array.isArray(ingredients) || ingredients.some((ing) => !ing?.item && !ing?.itemLocal)) {
    throw new Error("Invalid ingredients: each one needs an `item` (or `itemLocal`) name.");
  }

  const activeStoreId = storeId || MENY_STORE_ID;
  const weekNum = getWeekNumber();
  const cacheKey = `meny:wk${weekNum}:${dishName}:${activeStoreId}`;
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<MenyResponse>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      console.error("Redis read error:", err);
    }
  }

  const translations = await translateIngredients(ingredients, dishName);
  const matches: MenyIngredientMatch[] = [];

  for (let i = 0; i < translations.length; i++) {
    const t = translations[i];
    const orig = ingredients[i];
    if (i > 0) await delay(50);

    const hits = await searchMenyApi(t.searchTerm, activeStoreId);
    let relevant = hits
      .filter((h) => !h.contentData._source.isOutOfStock)
      .filter((h) => isRelevantProduct(h, t.searchTerm));

    if (
      relevant.length === 0 &&
      t.fallbackTerm &&
      t.fallbackTerm !== t.searchTerm
    ) {
      await delay(50);
      const fallbackHits = await searchMenyApi(t.fallbackTerm, activeStoreId);
      relevant = fallbackHits
        .filter((h) => !h.contentData._source.isOutOfStock)
        .filter((h) => isRelevantProduct(h, t.fallbackTerm));
    }

    if (relevant.length > 0) {
      const products = relevant.map(mapHitToProduct);
      const sorted = [...products].sort((a, b) => a.price - b.price);
      matches.push({
        ingredient: t.ingredient,
        searchTerm: t.searchTerm,
        product: sorted[0],
        alternatives: sorted.slice(1, 4),
        matched: true,
        recipeAmount: orig?.amount,
        recipeUnit: orig?.unit,
        pantryStaple: t.pantryStaple || false,
      });
    } else {
      matches.push({
        ingredient: t.ingredient,
        searchTerm: t.searchTerm,
        product: null,
        alternatives: [],
        matched: false,
        recipeAmount: orig?.amount,
        recipeUnit: orig?.unit,
        pantryStaple: t.pantryStaple || false,
      });
    }
  }

  const matchedCount = matches.filter((m) => m.matched).length;
  const totalPrice = matches.reduce(
    (sum, m) =>
      sum + (m.matched && !m.outOfStock ? m.product?.price || 0 : 0),
    0
  );

  const response: MenyResponse = {
    dishName,
    searchedCount: ingredients.length,
    store: MENY_STORE_NAME,
    storeId: activeStoreId,
    storeName: MENY_STORE_NAME,
    storeColor: "#D32F2F",
    storeLogo: "https://meny.no/favicon.ico",
    matches,
    totalPrice,
    matchedCount,
    totalCount: matches.length,
    allMatched: matchedCount === matches.length,
    generatedAt: new Date().toISOString(),
  };

  if (redis) {
    try {
      await redis.set(cacheKey, response, { ex: 3 * 24 * 60 * 60 });
    } catch (err) {
      console.error("Redis write error:", err);
    }
  }

  return response;
}
