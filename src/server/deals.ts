import { Redis } from "@upstash/redis";
import type {
  RecipeIngredient,
  ProductOffer,
  StoreRecommendation,
  DealsResponse,
} from "@/lib/types";
import { getWeekNumber } from "@/lib/dateUtils";

function getRedis() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return null;
}

const KASSAL_API_BASE = "https://kassal.app/api/v1";
const TJEK_API_BASE = "https://squid-api.tjek.com/v2";
const TJEK_DEALER_IDS =
  "faa0Ym,257bxm,4333pm,80742m,c062vm,5b11sm,b3e8Fm,68baam,de79dm,f5d5lm,51dawm";

const STORE_COLORS: Record<string, string> = {
  KIWI: "#6a9c2f",
  REMA_1000: "#004990",
  MENY_NO: "#c41230",
  SPAR_NO: "#e31e2d",
  JOKER_NO: "#d52b1e",
  BUNNPRIS: "#0053a0",
  COOP_NO: "#003ea0",
  COOP_PRIX: "#ee1c25",
  COOP_EXTRA: "#003ea0",
  COOP_MEGA: "#003ea0",
  COOP_OBS: "#003ea0",
  COOP_MARKED: "#003ea0",
  MATKROKEN: "#003ea0",
  ODA_NO: "#131313",
  EUROPRIS_NO: "#005ca9",
  NAERBUTIKKEN: "#d4282d",
  HOLDBART: "#1a1a2e",
  HAVARISTEN: "#b22222",
  FUDI: "#ff6b35",
  ENGROSSNETT_NO: "#333333",
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
  quantity: {
    size: { from: number; to: number } | null;
    unit: { symbol: string } | null;
  } | null;
  images: { zoom: string | null } | null;
  run_from: string;
  run_till: string;
  branding: {
    name: string;
    color: string | null;
    pageflip: { logo: string | null } | null;
  } | null;
}

const PANTRY_STAPLES = new Set([
  "salt",
  "pepper",
  "oil",
  "water",
  "sugar",
  "flour",
  "butter",
  "garlic",
  "onion",
  "vann",
  "olje",
  "olivenolje",
  "rapsolje",
  "smør",
  "sukker",
  "mel",
  "hvitløk",
  "løk",
]);

function isPantryStaple(name: string): boolean {
  return PANTRY_STAPLES.has(name.toLowerCase().trim());
}

async function searchKassalProducts(
  query: string
): Promise<KassalApiProduct[]> {
  const apiKey = process.env.KASSAL_API_KEY;
  if (!apiKey) return [];

  const url = `${KASSAL_API_BASE}/products?search=${encodeURIComponent(
    query
  )}&size=60`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

async function searchTjekOffers(query: string): Promise<TjekOffer[]> {
  try {
    const url = `${TJEK_API_BASE}/offers/search?query=${encodeURIComponent(
      query
    )}&dealer_ids=${TJEK_DEALER_IDS}&limit=30`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export interface FetchDealsPayload {
  ingredients: RecipeIngredient[];
  dishName: string;
  lang?: string;
}

export async function fetchDeals(data: FetchDealsPayload): Promise<DealsResponse> {
  const { ingredients, dishName } = data;
  if (!ingredients || !dishName) {
    throw new Error("Invalid request");
  }

  const weekNum = getWeekNumber();
  const cacheKey = `prices:v4:wk${weekNum}:${dishName}`;
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<DealsResponse>(cacheKey);
      if (cached) return cached;
    } catch (err) {
      console.error("Redis read error:", err);
    }
  }

  const searchableIngs = ingredients
    .filter((ing) => !isPantryStaple(ing.itemLocal || ing.item))
    .slice(0, 8);

  const allDeals: ProductOffer[] = [];
  const searchedIngredients = searchableIngs.map(
    (ing) => ing.itemLocal || ing.item
  );

  for (const ing of searchableIngs) {
    const searchTerm = (ing.itemLocal || ing.item).toLowerCase();
    const ingredientName = ing.itemLocal || ing.item;

    const [kassalProducts, tjekOffers] = await Promise.all([
      searchKassalProducts(searchTerm),
      searchTjekOffers(searchTerm),
    ]);

    for (const p of kassalProducts) {
      if (p.current_price && p.store) {
        allDeals.push({
          id: p.id.toString(),
          name: p.name,
          brand: p.brand,
          price: p.current_price,
          unitPrice: p.current_unit_price,
          imageUrl: p.image,
          store: p.store.name,
          storeCode: p.store.code,
          storeColor: STORE_COLORS[p.store.code] || "#888888",
          storeLogo: p.store.logo || "",
          matchedIngredient: ingredientName,
          productUrl: p.url || null,
          weight: p.weight ? `${p.weight}${p.weight_unit || "g"}` : null,
          isCampaign: false,
          originalPrice: null,
          savingsPercent: null,
          validUntil: null,
          source: "kassal",
        });
      }
    }

    for (const offer of tjekOffers) {
      if (offer.pricing.price != null) {
        allDeals.push({
          id: `tjek_${offer.id}`,
          name: offer.heading,
          brand: offer.branding?.name || null,
          price: offer.pricing.price,
          unitPrice: null,
          imageUrl: offer.images?.zoom || null,
          store: offer.branding?.name || "Ukjent",
          storeCode: "TJEK",
          storeColor: offer.branding?.color || "#004990",
          storeLogo: offer.branding?.pageflip?.logo || "",
          matchedIngredient: ingredientName,
          productUrl: `https://etilbudsavis.no/offers/${offer.id}`,
          weight: null,
          isCampaign: true,
          originalPrice: offer.pricing.pre_price || null,
          savingsPercent:
            offer.pricing.pre_price != null &&
            offer.pricing.pre_price > offer.pricing.price
              ? Math.round(
                  (1 - offer.pricing.price / offer.pricing.pre_price) * 100
                )
              : null,
          validUntil: offer.run_till,
          source: "tjek",
        });
      }
    }
  }

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

  storeRecs.sort((a, b) => b.keyIngredientsCovered - a.keyIngredientsCovered || a.totalPrice - b.totalPrice);

  const recommendation = storeRecs[0] || {
    store: "",
    storeColor: "#888888",
    storeLogo: "",
    totalPrice: 0,
    dealCount: 0,
    keyIngredientsCovered: 0,
    deals: [],
  };

  const response: DealsResponse = {
    recommendation,
    allStores: storeRecs,
    searchedIngredients,
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
