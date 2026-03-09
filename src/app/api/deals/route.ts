import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { Redis } from '@upstash/redis';
import type { RecipeIngredient, TjekOffer, StoreRecommendation, DealsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const NORWEGIAN_DEALER_IDS = 'faa0Ym,257bxm,4333pm,80742m,c062vm,5b11sm,b3e8Fm,68baam,de79dm,f5d5lm,51dawm';

interface GeminiIngredient {
  ingredient: string;
  searchTerms: string[];
  priority: number;
  isKeyIngredient: boolean;
}

function getWeekNumber(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

async function rankIngredients(ingredients: RecipeIngredient[], dishName: string, lang: 'no' | 'en'): Promise<GeminiIngredient[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const ai = new GoogleGenAI({ apiKey });

  const ingredientList = ingredients.map(i => `${i.amount} ${i.unit} ${i.item}`).join('\n');

  const prompt = `You are a Norwegian grocery shopping assistant. Given this recipe "${dishName}" with these ingredients:

${ingredientList}

Rank the ingredients by shopping importance for finding grocery deals. Focus on ingredients that:
1. Are expensive (proteins, cheese, specialty items)
2. Are frequently on sale at Norwegian grocery stores
3. Define the dish (key ingredients)

Skip cheap basics that everyone already has: salt, pepper, oil, water, sugar, flour, butter, garlic, onion.

Return ONLY a JSON array (max 6 items, minimum 2) sorted by priority:
[
  { "ingredient": "Original ingredient name", "searchTerms": ["norwegian_term1", "norwegian_term2"], "priority": 1, "isKeyIngredient": true }
]

Rules for searchTerms:
- Use short Norwegian grocery words (1-2 words max)
- Include common product variants (e.g. "laks" and "laksfilet" for salmon)
- Use lowercase
- 1-3 search terms per ingredient

Mark isKeyIngredient=true for the 2-3 ingredients that define the dish.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: { parts: [{ text: prompt }] },
    config: { responseMimeType: 'application/json' },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');

  return JSON.parse(text) as GeminiIngredient[];
}

interface TjekApiOffer {
  id: string;
  heading: string;
  description: string;
  pricing: { price: number; pre_price: number | null; currency: string };
  images: { zoom: string } | null;
  run_till: string;
  branding: { name: string; color: string; pageflip: { logo: string; color: string } };
}

async function searchTjekOffers(query: string): Promise<TjekApiOffer[]> {
  const url = `https://squid-api.tjek.com/v2/offers/search?query=${encodeURIComponent(query)}&dealer_ids=${NORWEGIAN_DEALER_IDS}&limit=4`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) return [];
  return res.json();
}

function normalizeColor(hex: string | undefined): string {
  if (!hex) return '#888888';
  const c = hex.replace(/^#/, '');
  // White/near-white colors are invisible on white cards — use a neutral dark instead
  if (['ffffff', 'fff', 'fefefe', 'fafafa'].includes(c.toLowerCase())) return '#333333';
  return `#${c}`;
}

function mapTjekOffer(offer: TjekApiOffer, matchedIngredient: string): TjekOffer {
  return {
    id: offer.id,
    heading: offer.heading,
    description: offer.description || '',
    price: offer.pricing?.price ?? 0,
    prePrice: offer.pricing?.pre_price ?? null,
    currency: offer.pricing?.currency || 'NOK',
    imageUrl: offer.images?.zoom || null,
    store: offer.branding?.name || 'Unknown',
    storeColor: normalizeColor(offer.branding?.pageflip?.color || offer.branding?.color),
    storeLogo: offer.branding?.pageflip?.logo || '',
    runTill: offer.run_till || '',
    matchedIngredient,
  };
}

function buildRecommendation(allDeals: TjekOffer[], keyIngredients: string[]): DealsResponse {
  // Group deals by store
  const storeMap = new Map<string, TjekOffer[]>();
  for (const deal of allDeals) {
    const existing = storeMap.get(deal.store) || [];
    existing.push(deal);
    storeMap.set(deal.store, existing);
  }

  // Build store recommendations
  const storeRecs: StoreRecommendation[] = [];
  for (const [store, deals] of storeMap) {
    // Pick cheapest deal per ingredient for this store
    const bestPerIngredient = new Map<string, TjekOffer>();
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
    searchedIngredients: [...new Set(allDeals.map(d => d.matchedIngredient))],
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
  const cacheKey = `deals:wk${weekNum}:${dishName}`;

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
    const ranked = await rankIngredients(ingredients as RecipeIngredient[], dishName, lang as 'no' | 'en');

    const keyIngredients = ranked.filter(r => r.isKeyIngredient).map(r => r.ingredient);

    // Step 2: Search Tjek API in parallel for each ingredient
    const allDeals: TjekOffer[] = [];
    const searchPromises = ranked.map(async (ing) => {
      const results: TjekOffer[] = [];
      // Search all terms in parallel for this ingredient
      const termResults = await Promise.all(
        ing.searchTerms.map(term => searchTjekOffers(term))
      );
      // Deduplicate by offer ID
      const seen = new Set<string>();
      for (const offers of termResults) {
        for (const offer of offers) {
          if (!seen.has(offer.id)) {
            seen.add(offer.id);
            results.push(mapTjekOffer(offer, ing.ingredient));
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
    const response = buildRecommendation(allDeals, keyIngredients);

    // Cache in Redis for 3 days
    try {
      await redis.set(cacheKey, response, { ex: 3 * 24 * 60 * 60 });
    } catch (err) {
      console.error('Redis write error:', err);
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Deals search failed:', error);
    return NextResponse.json({ error: 'Failed to find deals' }, { status: 500 });
  }
}
