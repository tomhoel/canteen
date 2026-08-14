import type { CanteenDayItem, MenuItem } from "@/lib/types";
import { rankItems, scoreMainDish } from "@/lib/dish-ranking";

// Ranking lives in dish-ranking.ts so the client, the scraper and the updater
// cannot disagree about which dish is the main one. Re-exported here to keep
// this module's existing public surface unchanged for its callers.
export { scoreMainDish };

const CLOSED_KEYWORDS = ["stengt", "closed", "lukket"];

/** Returns true if a canteen day item represents a closed / not-serving state. */
export function isCanteenClosed(item: CanteenDayItem): boolean {
  const { mainDish, items } = item;
  if (!mainDish && (!items || items.length === 0)) return true;
  const dishName = mainDish?.dish?.toLowerCase() ?? "";
  if (CLOSED_KEYWORDS.some((kw) => dishName.includes(kw))) return true;
  if (items?.some((i) => CLOSED_KEYWORDS.some((kw) => i.dish.toLowerCase().includes(kw))))
    return true;
  return false;
}

/** Returns items with the true Main Dish at index 0 marked with isMain: true. */
export function getRankedItems(rawItems: MenuItem[] | undefined, canteenName: string): MenuItem[] {
  return rankItems(rawItems, canteenName);
}

/** Returns high-resolution culinary food plate image matching the main dish name. */
export function getFoodImageForDish(dishName: string | undefined): string {
  if (!dishName) return "";
  const lower = dishName.toLowerCase();

  if (/wings|kylling|chicken/i.test(lower)) {
    return "https://images.unsplash.com/photo-1567620832903-9fc6debc209f?auto=format&fit=crop&w=800&q=80"; // Crispy Wings / Chicken
  }
  if (/biff|beef|steak|slakterbiff|karbonad|patties/i.test(lower)) {
    return "https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=800&q=80"; // Tender Steak & Potatoes
  }
  if (/torsk|cod|rødspette|plaice|laks|salmon|fisk|fish/i.test(lower)) {
    return "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=800&q=80"; // Baked Fish & Sides
  }
  if (/suppe|soup|betasuppe|fiskesuppe/i.test(lower)) {
    return "https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=800&q=80"; // Warming Soup Bowl
  }
  if (/pasta|bolognese|carbonara|spaghetti/i.test(lower)) {
    return "https://images.unsplash.com/photo-1621996346565-e3d5d6281318?auto=format&fit=crop&w=800&q=80"; // Pasta Dish
  }
  if (/curry|tandoori|indisk|gryte|stew|stroganoff|coq au vin/i.test(lower)) {
    return "https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=800&q=80"; // Rich Stew / Curry
  }
  if (/schnitzel|panert/i.test(lower)) {
    return "https://images.unsplash.com/photo-1599921841143-819065a55703?auto=format&fit=crop&w=800&q=80"; // Golden Schnitzel
  }
  if (/taco|burrito|tortilla|meksikansk/i.test(lower)) {
    return "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=800&q=80"; // Tacos / Tortilla
  }
  if (/pizza/i.test(lower)) {
    return "https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80"; // Pizza
  }

  return "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=80";
}
