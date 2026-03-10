import { NextRequest, NextResponse } from 'next/server';
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

const PANTRY_STAPLES = new Set([
  'salt', 'pepper', 'oil', 'water', 'sugar', 'flour', 'butter', 'garlic', 'onion',
  'vann', 'olje', 'olivenolje', 'rapsolje', 'smør', 'sukker', 'mel', 'hvitløk', 'løk',
  'hvitløksfedd', 'vegetabilsk olje', 'bakepulver', 'natron', 'eddik', 'sitronsaft',
  'soyasaus', 'salt og pepper', 'olje til steking',
]);

function isPantryStaple(name: string): boolean {
  return PANTRY_STAPLES.has(name.toLowerCase().trim());
}

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

// Baby food / irrelevant product patterns to exclude
const EXCLUDE_PATTERNS = [
  /\b\d+\s*mnd\b/i,
  /\b\d+-\d+\s*år\b/i,
  /\bfra\s+\d+\s*mnd\b/i,
  /\bbarnegrøt\b/i,
  /\bbarnemat\b/i,
  /\bsmoothie\b/i,
];

const EXCLUDE_BRANDS = new Set([
  'semper', 'hipp', 'nestlé', 'nestle', 'ella\'s kitchen',
  'ellas kitchen', 'holle', 'kiddylicious',
]);

function isRelevantProduct(product: KassalApiProduct, searchTerms: string[]): boolean {
  const name = product.name.toLowerCase();
  if (!searchTerms.some(term => name.includes(term.toLowerCase()))) return false;
  if (EXCLUDE_PATTERNS.some(p => p.test(product.name))) return false;
  if (product.brand && EXCLUDE_BRANDS.has(product.brand.toLowerCase())) return false;
  return true;
}

function isRelevantTjekOffer(offer: TjekOffer, searchTerms: string[]): boolean {
  const heading = offer.heading.toLowerCase();
  if (!searchTerms.some(term => heading.includes(term.toLowerCase()))) return false;
  if (EXCLUDE_PATTERNS.some(p => p.test(offer.heading))) return false;
  if (offer.pricing.price == null) return false;
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
    source: 'kassal',
  };
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
    source: 'tjek',
  };
}

function buildRecommendation(allDeals: ProductOffer[], allSearchedIngredients: string[]): DealsResponse {
  const storeMap = new Map<string, ProductOffer[]>();
  for (const deal of allDeals) {
    const existing = storeMap.get(deal.store) || [];
    existing.push(deal);
    storeMap.set(deal.store, existing);
  }

  const storeRecs: StoreRecommendation[] = [];
  for (const [store, deals] of storeMap) {
    const bestPerIngredient = new Map<string, ProductOffer>();
    for (const deal of deals) {
      const existing = bestPerIngredient.get(deal.matchedIngredient);
      if (!existing || deal.price < existing.price) {
        bestPerIngredient.set(deal.matchedIngredient, deal);
      }
    }

    const bestDeals = Array.from(bestPerIngredient.values());

    storeRecs.push({
      store,
      storeColor: deals[0].storeColor,
      storeLogo: deals[0].storeLogo,
      totalPrice: bestDeals.reduce((sum, d) => sum + d.price, 0),
      dealCount: bestDeals.length,
      keyIngredientsCovered: bestDeals.length,
      deals: bestDeals,
    });
  }

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

async function searchIngredient(ing: RecipeIngredient): Promise<{ name: string; deals: ProductOffer[] }> {
  const searchTerm = (ing.itemLocal || ing.item).toLowerCase();
  const ingredientName = ing.itemLocal || ing.item;

  const [kassalProducts, tjekOffers] = await Promise.all([
    searchKassalProducts(searchTerm),
    searchTjekOffers(searchTerm),
  ]);

  const deals: ProductOffer[] = [];

  const seenKassal = new Set<number>();
  for (const product of kassalProducts) {
    if (!seenKassal.has(product.id) && isRelevantProduct(product, [searchTerm])) {
      seenKassal.add(product.id);
      const mapped = mapKassalProduct(product, ingredientName);
      if (mapped) deals.push(mapped);
    }
  }

  const seenTjek = new Set<string>();
  for (const offer of tjekOffers) {
    if (!seenTjek.has(offer.id) && isRelevantTjekOffer(offer, [searchTerm])) {
      seenTjek.add(offer.id);
      const mapped = mapTjekOffer(offer, ingredientName);
      if (mapped) deals.push(mapped);
    }
  }

  return { name: ingredientName, deals };
}

export async function POST(request: NextRequest) {
  const { ingredients, dishName, lang } = await request.json();

  if (!ingredients || !dishName || !['no', 'en'].includes(lang)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Check Redis cache — return JSON immediately
  const weekNum = getWeekNumber();
  const cacheKey = `prices:v4:wk${weekNum}:${dishName}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }
  } catch (err) {
    console.error('Redis read error:', err);
  }

  // Filter pantry staples, keep recipe order
  const searchableIngs = (ingredients as RecipeIngredient[])
    .filter(ing => !isPantryStaple(ing.itemLocal || ing.item))
    .slice(0, 8);

  if (searchableIngs.length === 0) {
    return NextResponse.json({ error: 'No searchable ingredients' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const allDeals: ProductOffer[] = [];
  const searchedIngredients = searchableIngs.map(ing => ing.itemLocal || ing.item);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const t0 = Date.now();

        // Fire all ingredient searches in parallel, stream in recipe order
        const results: ({ name: string; deals: ProductOffer[] } | undefined)[] = new Array(searchableIngs.length).fill(undefined);
        let nextIndex = 0;

        await new Promise<void>((resolve) => {
          let completed = 0;

          searchableIngs.forEach((ing, i) => {
            searchIngredient(ing).then(result => {
              results[i] = result;
              completed++;

              // Flush all consecutive ready results in recipe order
              while (nextIndex < searchableIngs.length && results[nextIndex] !== undefined) {
                const r = results[nextIndex]!;
                allDeals.push(...r.deals);

                const event = JSON.stringify({ type: 'ingredient', name: r.name, deals: r.deals });
                controller.enqueue(encoder.encode(`data: ${event}\n\n`));
                nextIndex++;
              }

              if (completed === searchableIngs.length) resolve();
            }).catch(() => {
              results[i] = { name: searchableIngs[i].itemLocal || searchableIngs[i].item, deals: [] };
              completed++;

              while (nextIndex < searchableIngs.length && results[nextIndex] !== undefined) {
                const r = results[nextIndex]!;
                allDeals.push(...r.deals);
                const event = JSON.stringify({ type: 'ingredient', name: r.name, deals: r.deals });
                controller.enqueue(encoder.encode(`data: ${event}\n\n`));
                nextIndex++;
              }

              if (completed === searchableIngs.length) resolve();
            });
          });
        });

        console.log(`[deals] Search: ${Date.now() - t0}ms | Ingredients: ${searchableIngs.length} | Deals: ${allDeals.length}`);

        // Build final recommendation
        const response = buildRecommendation(allDeals, searchedIngredients);

        // Cache in Redis for 3 days
        try {
          await redis.set(cacheKey, response, { ex: 3 * 24 * 60 * 60 });
        } catch (err) {
          console.error('Redis write error:', err);
        }

        // Send final event with full recommendation
        const doneEvent = JSON.stringify({ type: 'done', ...response });
        controller.enqueue(encoder.encode(`data: ${doneEvent}\n\n`));
        controller.close();
      } catch (err) {
        console.error('Streaming error:', err);
        const errEvent = JSON.stringify({ type: 'error', message: 'Search failed' });
        controller.enqueue(encoder.encode(`data: ${errEvent}\n\n`));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
}
