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
