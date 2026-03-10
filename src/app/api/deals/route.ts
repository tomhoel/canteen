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
const TJEK_API_BASE = 'https://squid-api.tjek.com/v2';
const TJEK_DEALER_IDS = 'faa0Ym,257bxm,4333pm,80742m,c062vm,5b11sm,b3e8Fm,68baam,de79dm,f5d5lm,51dawm';

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

interface TjekOffer {
  id: string;
  heading: string;
  description: string | null;
  pricing: { price: number | null; pre_price: number | null; currency: string };
  quantity: { size: { from: number; to: number } | null; unit: { symbol: string } | null } | null;
  images: { zoom: string | null } | null;
  run_from: string;
  run_till: string;
  branding: { name: string; color: string | null; pageflip: { logo: string | null } | null } | null;
}

const STORE_NAME_MAP: Record<string, string> = {
  'kiwi': 'KIWI',
  'rema 1000': 'Rema 1000',
  'rema': 'Rema 1000',
  'meny': 'MENY',
  'spar': 'SPAR',
  'joker': 'Joker',
  'bunnpris': 'Bunnpris',
  'coop prix': 'Coop Prix',
  'coop extra': 'Coop Extra',
  'coop mega': 'Coop Mega',
  'coop obs': 'Coop Obs',
  'coop marked': 'Coop Marked',
  'oda': 'Oda',
  'europris': 'Europris',
};

function normalizeStoreName(name: string): string {
  const lower = name.toLowerCase().trim();
  return STORE_NAME_MAP[lower] || name;
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
- NEVER use short generic terms that match unrelated products. Every term must be specific enough to find the actual raw ingredient, not processed foods, baby food, or flavored snacks.
- Good examples: "kyllingfilet" (not "kylling"), "kjøttdeig" (not "kjøtt"), "matfløte" (not "fløte"), "basmatiris" (not "ris"), "hermetiske tomater" (not "tomat"), "revet parmesan" (not "ost"), "frisk spinat" (not "spinat" alone)
- BAD examples that return garbage: "ris" (baby food), "fløte" (ice cream), "ost" (cheese-flavored snacks), "laks" (baby food), "pasta" (baby food)
- Provide 2-3 SPECIFIC variants. Do NOT include a broad fallback term.
  Example for rice: ["basmatiris", "jasminris", "langkornet ris"]
  Example for cream: ["matfløte", "kremfløte", "matfløte 18"]
  Example for salmon: ["laksfilet", "laksefilet", "fersk laks"]
  Example for chicken: ["kyllingfilet", "kyllingbryst", "kylling hel"]
  Example for cheese: ["revet ost", "norvegia", "revet parmesan"]
  Example for spinach: ["frisk spinat", "babyspinat", "spinat pose"]
- Use lowercase
- 2-3 search terms per ingredient, ALL specific

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

async function searchTjekOffers(query: string): Promise<TjekOffer[]> {
  try {
    const url = `${TJEK_API_BASE}/offers/search?query=${encodeURIComponent(query)}&dealer_ids=${TJEK_DEALER_IDS}&limit=30`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

function isRelevantTjekOffer(offer: TjekOffer, searchTerms: string[]): boolean {
  const heading = offer.heading.toLowerCase();
  if (!searchTerms.some(term => heading.includes(term.toLowerCase()))) return false;
  if (EXCLUDE_PATTERNS.some(p => p.test(offer.heading))) return false;
  if (offer.pricing.price == null) return false;
  return true;
}

function getTjekStoreCode(storeName: string): string {
  const lower = storeName.toLowerCase();
  if (lower.includes('kiwi')) return 'KIWI';
  if (lower.includes('rema')) return 'REMA_1000';
  if (lower.includes('meny')) return 'MENY_NO';
  if (lower.includes('spar')) return 'SPAR_NO';
  if (lower.includes('joker')) return 'JOKER_NO';
  if (lower.includes('bunnpris')) return 'BUNNPRIS';
  if (lower.includes('prix')) return 'COOP_PRIX';
  if (lower.includes('extra')) return 'COOP_EXTRA';
  if (lower.includes('mega')) return 'COOP_MEGA';
  if (lower.includes('obs')) return 'COOP_OBS';
  if (lower.includes('coop')) return 'COOP_NO';
  if (lower.includes('europris')) return 'EUROPRIS_NO';
  return '';
}

function mapTjekOffer(offer: TjekOffer, matchedIngredient: string): ProductOffer | null {
  if (offer.pricing.price == null) return null;
  const storeName = offer.branding?.name ? normalizeStoreName(offer.branding.name) : 'Ukjent';
  const storeCode = getTjekStoreCode(storeName);

  let savingsPercent: number | null = null;
  if (offer.pricing.pre_price != null && offer.pricing.pre_price > offer.pricing.price) {
    savingsPercent = Math.round((1 - offer.pricing.price / offer.pricing.pre_price) * 100);
  }

  let weight: string | null = null;
  if (offer.quantity?.size && offer.quantity.unit?.symbol) {
    const size = offer.quantity.size.from === offer.quantity.size.to
      ? `${offer.quantity.size.from}`
      : `${offer.quantity.size.from}-${offer.quantity.size.to}`;
    weight = `${size}${offer.quantity.unit.symbol}`;
  }

  return {
    id: `tjek_${offer.id}`,
    name: offer.heading,
    brand: offer.branding?.name || null,
    price: offer.pricing.price,
    unitPrice: null,
    imageUrl: offer.images?.zoom || null,
    store: storeName,
    storeCode,
    storeColor: offer.branding?.color || getStoreColor(storeCode),
    storeLogo: offer.branding?.pageflip?.logo || '',
    matchedIngredient,
    productUrl: `https://etilbudsavis.no/offers/${offer.id}`,
    weight,
    isCampaign: true,
    originalPrice: offer.pricing.pre_price || null,
    savingsPercent,
    validUntil: offer.run_till,
  };
}

// Baby food / irrelevant product patterns to exclude
const EXCLUDE_PATTERNS = [
  /\b\d+\s*mnd\b/i,          // "6mnd", "8 mnd" = baby food age labels
  /\b\d+-\d+\s*år\b/i,       // "1-3år" = toddler food
  /\bfra\s+\d+\s*mnd\b/i,    // "fra 6 mnd"
  /\bbarnegrøt\b/i,           // baby porridge
  /\bbarnemat\b/i,            // baby food
  /\bsmoothie\b/i,            // smoothie pouches (often baby food)
];

const EXCLUDE_BRANDS = new Set([
  'semper', 'hipp', 'nestlé', 'nestle', 'ella\'s kitchen',
  'ellas kitchen', 'holle', 'kiddylicious',
]);

function isRelevantProduct(product: KassalApiProduct, searchTerms: string[]): boolean {
  const name = product.name.toLowerCase();

  // Must contain at least one search term
  if (!searchTerms.some(term => name.includes(term.toLowerCase()))) return false;

  // Exclude baby food by pattern
  if (EXCLUDE_PATTERNS.some(p => p.test(product.name))) return false;

  // Exclude known baby food brands
  if (product.brand && EXCLUDE_BRANDS.has(product.brand.toLowerCase())) return false;

  return true;
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
    isCampaign: false,
    originalPrice: null,
    savingsPercent: null,
    validUntil: null,
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
  const cacheKey = `prices:v3:wk${weekNum}:${dishName}`;

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

    // Step 2: Search Kassal + Tjek in parallel for each ingredient
    const allDeals: ProductOffer[] = [];
    const searchPromises = ranked.map(async (ing) => {
      const results: ProductOffer[] = [];
      // Search all terms in parallel across both APIs
      const kassalPromises = ing.searchTerms.map(term => searchKassalProducts(term));
      const tjekPromises = ing.searchTerms.map(term => searchTjekOffers(term));
      const [kassalResults, tjekResults] = await Promise.all([
        Promise.all(kassalPromises),
        Promise.all(tjekPromises),
      ]);
      // Deduplicate Kassal by product ID + filter irrelevant results
      const seenKassal = new Set<number>();
      for (const products of kassalResults) {
        for (const product of products) {
          if (!seenKassal.has(product.id) && isRelevantProduct(product, ing.searchTerms)) {
            seenKassal.add(product.id);
            const mapped = mapKassalProduct(product, ing.ingredient);
            if (mapped) results.push(mapped);
          }
        }
      }
      // Deduplicate Tjek by offer ID + filter irrelevant results
      const seenTjek = new Set<string>();
      for (const offers of tjekResults) {
        for (const offer of offers) {
          if (!seenTjek.has(offer.id) && isRelevantTjekOffer(offer, ing.searchTerms)) {
            seenTjek.add(offer.id);
            const mapped = mapTjekOffer(offer, ing.ingredient);
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
