import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Redis } from '@upstash/redis';
import type { RecipeIngredient, ProductOffer, StoreRecommendation, DealsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const KASSAL_API_BASE = 'https://kassal.app/api/v1';

const STORE_COLORS: Record<string, string> = {
  KIWI: '#6a9c2f',
  REMA_1000: '#004990',
  MENY_NO: '#c41230',
  SPAR_NO: '#e31e2d',
  JOKER_NO: '#d52b1e',
  BUNNPRIS: '#0053a0',
  COOP_NO: '#003ea0',
  COOP_PRIX: '#ee1c25',
  COOP_EXTRA: '#003ea0',
  COOP_MEGA: '#003ea0',
  COOP_OBS: '#003ea0',
  COOP_MARKED: '#003ea0',
  MATKROKEN: '#003ea0',
  ODA_NO: '#131313',
  EUROPRIS_NO: '#005ca9',
  NAERBUTIKKEN: '#d4282d',
  HOLDBART: '#1a1a2e',
  HAVARISTEN: '#b22222',
  FUDI: '#ff6b35',
  ENGROSSNETT_NO: '#333333',
};

interface GeminiIngredient {
  ingredient: string;
  searchTerms: string[];
  priority: number;
  isKeyIngredient: boolean;
}

interface KassalApiProduct {
  id: number;
  name: string;
  brand: string | null;
  ean: string | null;
  url: string | null;
  image: string | null;
  current_price: number | null;
  current_unit_price: number | null;
  weight: number | null;
  weight_unit: string | null;
  store: {
    name: string;
    code: string;
    url: string | null;
    logo: string | null;
  } | null;
}

function getWeekNumber(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function rankIngredients(ingredients: RecipeIngredient[], dishName: string): Promise<GeminiIngredient[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const ai = new GoogleGenAI({ apiKey });

  const ingredientList = ingredients.map(i => `${i.amount} ${i.unit} ${i.item}`).join('\n');

  const prompt = `You are a Norwegian grocery shopping assistant. Given this recipe "${dishName}" with these ingredients:

${ingredientList}

Rank the ingredients by shopping importance for finding the best grocery prices. Focus on ingredients that:
1. Are expensive (proteins, cheese, specialty items)
2. Have significant price variation between stores
3. Define the dish (key ingredients)

Skip cheap basics that everyone already has: salt, pepper, oil, water, sugar, flour, butter, garlic, onion.

Return ONLY a JSON array (max 6 items, minimum 2) sorted by priority:
[
  { "ingredient": "Original ingredient name", "searchTerms": ["norwegian_term1", "norwegian_term2"], "priority": 1, "isKeyIngredient": true }
]

Rules for searchTerms — THIS IS CRITICAL:
- These terms are used to search a Norwegian grocery product database (Kassal.app)
- Use the EXACT product name as it appears on a grocery store shelf, in Norwegian
- Be SPECIFIC to the actual product, not a general food category
- Good examples: "kyllingfilet" (not just "kylling"), "kjøttdeig" (not "kjøtt"), "matfløte" (not "fløte"), "basmatiris" (not "ris"), "hermetiske tomater" (not "tomat")
- BAD examples: "ris" (matches rice pudding, protein bowls), "tomat" (matches ketchup, sauces)
- Include 2-3 variants: a specific term AND a broader product term
  Example for rice: ["basmatiris", "jasminris", "ris"]
  Example for cream: ["matfløte", "kremfløte", "fløte"]
- Use lowercase
- 2-3 search terms per ingredient

Mark isKeyIngredient=true for the 2-3 ingredients that define the dish.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: { parts: [{ text: prompt }] },
    config: { responseMimeType: 'application/json' },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');

  return JSON.parse(text) as GeminiIngredient[];
}

async function searchKassalProducts(query: string): Promise<KassalApiProduct[]> {
  const apiKey = process.env.KASSAL_API_KEY;
  if (!apiKey) throw new Error('KASSAL_API_KEY not configured');

  const url = `${KASSAL_API_BASE}/products?search=${encodeURIComponent(query)}&size=60`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

function isRelevantProduct(product: KassalApiProduct, searchTerms: string[]): boolean {
  const name = product.name.toLowerCase();
  return searchTerms.some(term => name.includes(term.toLowerCase()));
}

function buildWeightLabel(weight: number | null, unit: string | null): string | null {
  if (!weight || !unit) return null;
  if (unit === 'kg' && weight < 1) return `${Math.round(weight * 1000)}g`;
  if (unit === 'kg') return `${weight}kg`;
  return `${weight}${unit}`;
}

function getStoreColor(code: string): string {
  return STORE_COLORS[code] || '#888888';
}

function mapKassalProduct(product: KassalApiProduct, matchedIngredient: string): ProductOffer | null {
  if (!product.current_price || !product.store) return null;

  return {
    id: product.id.toString(),
    name: product.name,
    brand: product.brand,
    price: product.current_price,
    unitPrice: product.current_unit_price,
    imageUrl: product.image,
    store: product.store.name,
    storeCode: product.store.code,
    storeColor: getStoreColor(product.store.code),
    storeLogo: product.store.logo || '',
    matchedIngredient,
    productUrl: product.url || null,
    weight: buildWeightLabel(product.weight, product.weight_unit),
  };
}

function buildRecommendation(allDeals: ProductOffer[], keyIngredients: string[], allSearchedIngredients: string[]): DealsResponse {
  // Group by store
  const storeMap = new Map<string, ProductOffer[]>();
  for (const deal of allDeals) {
    const existing = storeMap.get(deal.store) || [];
    existing.push(deal);
    storeMap.set(deal.store, existing);
  }

  // Build store recommendations
  const storeRecs: StoreRecommendation[] = [];
  for (const [store, deals] of storeMap) {
    // Pick cheapest product per ingredient for this store
    const bestPerIngredient = new Map<string, ProductOffer>();
    for (const deal of deals) {
      const existing = bestPerIngredient.get(deal.matchedIngredient);
      if (!existing || deal.price < existing.price) {
        bestPerIngredient.set(deal.matchedIngredient, deal);
      }
    }

    const bestDeals = Array.from(bestPerIngredient.values());
    const keyCount = bestDeals.filter(d => keyIngredients.includes(d.matchedIngredient)).length;

    storeRecs.push({
      store,
      storeColor: deals[0].storeColor,
      storeLogo: deals[0].storeLogo,
      totalPrice: bestDeals.reduce((sum, d) => sum + d.price, 0),
      dealCount: bestDeals.length,
      keyIngredientsCovered: keyCount,
      deals: bestDeals,
    });
  }

  // Sort: most key ingredients covered, then lowest total price
  storeRecs.sort((a, b) => {
    if (b.keyIngredientsCovered !== a.keyIngredientsCovered) {
      return b.keyIngredientsCovered - a.keyIngredientsCovered;
    }
    return a.totalPrice - b.totalPrice;
  });

  const recommendation = storeRecs[0] || {
    store: '',
    storeColor: '#888888',
    storeLogo: '',
    totalPrice: 0,
    dealCount: 0,
    keyIngredientsCovered: 0,
    deals: [],
  };

  return {
    recommendation,
    allStores: storeRecs,
    searchedIngredients: allSearchedIngredients,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(request: NextRequest) {
  const { ingredients, dishName, lang } = await request.json();

  if (!ingredients || !dishName || !['no', 'en'].includes(lang)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Check Redis cache
  const weekNum = getWeekNumber();
  const cacheKey = `prices:wk${weekNum}:${dishName}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  } catch (err) {
    console.error('Redis read error:', err);
  }

  try {
    // Step 1: Rank ingredients with Gemini
    const ranked = await rankIngredients(ingredients as RecipeIngredient[], dishName);

    const keyIngredients = ranked.filter(r => r.isKeyIngredient).map(r => r.ingredient);

    // Step 2: Search Kassal.app in parallel for each ingredient
    const allDeals: ProductOffer[] = [];
    const searchPromises = ranked.map(async (ing) => {
      const results: ProductOffer[] = [];
      // Search all terms in parallel for this ingredient
      const termResults = await Promise.all(
        ing.searchTerms.map(term => searchKassalProducts(term))
      );
      // Deduplicate by product ID + filter irrelevant results
      const seen = new Set<number>();
      for (const products of termResults) {
        for (const product of products) {
          if (!seen.has(product.id) && isRelevantProduct(product, ing.searchTerms)) {
            seen.add(product.id);
            const mapped = mapKassalProduct(product, ing.ingredient);
            if (mapped) results.push(mapped);
          }
        }
      }
      return results;
    });

    const ingredientResults = await Promise.all(searchPromises);
    for (const results of ingredientResults) {
      allDeals.push(...results);
    }

    // Step 3: Build recommendation
    const allSearchedIngredients = ranked.map(r => r.ingredient);
    const response = buildRecommendation(allDeals, keyIngredients, allSearchedIngredients);

    // Cache in Redis for 3 days
    try {
      await redis.set(cacheKey, response, { ex: 3 * 24 * 60 * 60 });
    } catch (err) {
      console.error('Redis write error:', err);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Price search failed:', error);
    return NextResponse.json({ error: 'Failed to find prices' }, { status: 500 });
  }
}
