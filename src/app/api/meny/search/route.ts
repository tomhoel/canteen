import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Redis } from '@upstash/redis';
import type { RecipeIngredient, MenyProduct, MenyIngredientMatch, MenyResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const MENY_STORE_ID = process.env.MENY_DEFAULT_STORE_ID || '7080001150488'; // Meny Bryn
const MENY_STORE_NAME = 'MENY Bryn';

function getWeekNumber(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

interface GeminiTranslation {
  ingredient: string;
  searchTerm: string;
  fallbackTerm: string; // broader/alternative Norwegian term to try if searchTerm returns nothing
}

async function translateIngredients(ingredients: RecipeIngredient[], dishName: string): Promise<GeminiTranslation[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const ai = new GoogleGenAI({ apiKey });

  const ingredientList = ingredients.map(i => `${i.amount} ${i.unit} ${i.item}`).join('\n');

  const prompt = `You are a Norwegian grocery shopping assistant. Given this recipe "${dishName}" with these ingredients:

${ingredientList}

Translate ALL ingredients to Norwegian product search terms for Meny.no grocery store.

Return ONLY a JSON array with one entry per ingredient:
[
  { "ingredient": "Original ingredient name", "searchTerm": "specific norwegian product name", "fallbackTerm": "broader fallback if specific not found" }
]

Rules for searchTerm — THIS IS CRITICAL:
- Use the EXACT product name as it appears on a Norwegian grocery store shelf
- Be SPECIFIC: "kyllingfilet" not "kylling", "kjøttdeig" not "kjøtt", "matfløte" not "fløte"
- Use singular form and lowercase
- For basics like salt, pepper, sugar: still translate them (e.g., "salt", "pepper", "sukker")
- One search term per ingredient — pick the most common product name
- Examples: chicken breast → "kyllingbryst", cream → "matfløte", rice → "basmatiris", pasta → "pasta", tomato → "tomat", garlic → "hvitløk", onion → "løk", olive oil → "olivenolje", vegetable oil → "rapsolje", canola oil → "rapsolje", sunflower oil → "solsikkeolje", flour → "hvetemel", butter → "smør", egg → "egg", milk → "melk"

Rules for fallbackTerm:
- A broader or alternative Norwegian name to search if searchTerm returns no results
- Still specific enough to return the right product category
- Examples: "kyllingbryst" → "kylling", "rapsolje" → "matolje", "hvetemel" → "mel", "matfløte" → "fløte", "olivenolje" → "olje", "basmatiris" → "ris"
- For items with only one natural name (salt, pepper, sukker), repeat the same term as fallback`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: { parts: [{ text: prompt }] },
    config: { responseMimeType: 'application/json' },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');

  return JSON.parse(text) as GeminiTranslation[];
}

interface MenyApiHit {
  contentId: string;
  title: string;
  description: string;
  imageId: string;
  contentData: {
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
    };
  };
}

interface MenyApiResponse {
  hits: {
    hits: MenyApiHit[];
  };
}

async function searchMeny(term: string, storeId: string): Promise<MenyApiHit[]> {
  const url = `https://platform-rest-prod.ngdata.no/api/episearch/1300/products?search=${encodeURIComponent(term)}&page_size=5&store_id=${storeId}&full_response=true`;

  const res = await fetch(url, {
    headers: {
      'fwc-chain-id': '1300',
      'Origin': 'https://meny.no',
      'Referer': 'https://meny.no/',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  if (!res.ok) return [];
  const data = await res.json() as MenyApiResponse;
  return data.hits?.hits || [];
}

function mapHitToProduct(hit: MenyApiHit): MenyProduct {
  const src = hit.contentData._source;
  const comparePrice = src.comparePricePerUnit;
  const compareUnit = src.compareUnit;

  return {
    ean: src.ean || hit.contentId,
    name: src.title,
    subtitle: src.subtitle || hit.description || '',
    brand: src.brand || '',
    price: src.pricePerUnit,
    pricePerUnit: comparePrice && compareUnit
      ? `${comparePrice.toFixed(2).replace('.', ',')} kr/${compareUnit}`
      : null,
    imageUrl: `https://bilder.ngdata.no/${src.ean}/meny/large.jpg`,
    weight: src.weight ? `${src.weight} ${src.compareUnit || 'kg'}` : null,
    productUrl: src.ean ? `https://meny.no/search/?q=${src.ean}` : null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function POST(request: NextRequest) {
  const { ingredients, dishName, lang, storeId } = await request.json();

  if (!ingredients || !dishName) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const activeStoreId = storeId || MENY_STORE_ID;

  // Check Redis cache
  const weekNum = getWeekNumber();
  const cacheKey = `meny:wk${weekNum}:${dishName}:${activeStoreId}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  } catch (err) {
    console.error('Redis read error:', err);
  }

  try {
    // Step 1: Translate ingredients with Gemini
    const translations = await translateIngredients(ingredients as RecipeIngredient[], dishName);

    // Step 2: Search Meny API for each ingredient with staggered requests
    const matches: MenyIngredientMatch[] = [];

    for (let i = 0; i < translations.length; i++) {
      const t = translations[i];
      if (i > 0) await delay(50);

      // Tier 1: try specific searchTerm, in-stock only
      let hits = await searchMeny(t.searchTerm, activeStoreId);
      let inStockHits = hits.filter(h => !h.contentData._source.isOutOfStock);

      // Tier 2: try fallbackTerm if primary returned nothing in-stock
      if (inStockHits.length === 0 && t.fallbackTerm && t.fallbackTerm !== t.searchTerm) {
        await delay(50);
        const fallbackHits = await searchMeny(t.fallbackTerm, activeStoreId);
        const fallbackInStock = fallbackHits.filter(h => !h.contentData._source.isOutOfStock);
        if (fallbackInStock.length > 0) {
          inStockHits = fallbackInStock;
          hits = fallbackHits;
        } else {
          // merge both hit sets for out-of-stock fallback below
          hits = [...hits, ...fallbackHits].filter(
            (h, idx, arr) => arr.findIndex(x => x.contentId === h.contentId) === idx
          );
        }
      }

      if (inStockHits.length > 0) {
        const products = inStockHits.map(mapHitToProduct);
        const sorted = [...products].sort((a, b) => a.price - b.price);
        matches.push({
          ingredient: t.ingredient,
          searchTerm: t.searchTerm,
          product: sorted[0],
          alternatives: sorted.slice(1, 4),
          matched: true,
        });
      } else {
        // Tier 3: if truly nothing in-stock, use best out-of-stock result
        const outOfStockHits = hits.filter(h => h.contentData._source.isOutOfStock);
        if (outOfStockHits.length > 0) {
          const products = outOfStockHits.map(mapHitToProduct);
          const sorted = [...products].sort((a, b) => a.price - b.price);
          matches.push({
            ingredient: t.ingredient,
            searchTerm: t.searchTerm,
            product: sorted[0],
            alternatives: [],
            matched: true,
            outOfStock: true,
          });
        } else {
          matches.push({
            ingredient: t.ingredient,
            searchTerm: t.searchTerm,
            product: null,
            alternatives: [],
            matched: false,
          });
        }
      }
    }

    const matchedCount = matches.filter(m => m.matched).length;
    const totalPrice = matches.reduce((sum, m) => sum + (m.product?.price || 0), 0);

    const response: MenyResponse = {
      storeId: activeStoreId,
      storeName: MENY_STORE_NAME,
      matches,
      totalPrice,
      matchedCount,
      totalCount: matches.length,
      allMatched: matchedCount === matches.length,
      generatedAt: new Date().toISOString(),
    };

    // Cache in Redis for 3 days
    try {
      await redis.set(cacheKey, response, { ex: 3 * 24 * 60 * 60 });
    } catch (err) {
      console.error('Redis write error:', err);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Meny search failed:', error);
    return NextResponse.json({ error: 'Failed to search Meny products' }, { status: 500 });
  }
}
