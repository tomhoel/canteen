import type { CanteenDayItem } from "@/lib/types";

const CLOSED_KEYWORDS = ["stengt", "closed", "lukket"];

/** Returns true if a canteen day item represents a closed / not-serving state. */
export function isCanteenClosed(item: CanteenDayItem): boolean {
  const { mainDish, items, isAhead } = item;
  if (isAhead) return true;
  if (!mainDish && (!items || items.length === 0)) return true;
  const dishName = mainDish?.dish?.toLowerCase() ?? "";
  if (CLOSED_KEYWORDS.some(kw => dishName.includes(kw))) return true;
  if (items?.some(i => CLOSED_KEYWORDS.some(kw => i.dish.toLowerCase().includes(kw)))) return true;
  return false;
}
