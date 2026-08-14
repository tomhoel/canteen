import type { MenuItem } from "./types.ts";

/**
 * Single source of truth for "which of today's dishes is the main dish".
 *
 * This used to exist as three separate copies — one in the client
 * (canteen-utils), one in the scraper, one in the updater script. They had to
 * agree exactly, because the updater uses the winner to name the generated
 * plate image (`<day>/<canteen>.png`) while the client uses its own winner to
 * decide which dish that image is displayed against. Any drift between the
 * copies shows up to the user as a photo of the wrong food.
 */

/** Canteen whose pizza is a permanent fixture, never the dish of the day. */
const PIZZA_IS_NEVER_MAIN_AT = "Eat the street";

/**
 * Centrepiece proteins and composed mains. `lam` needs a boundary so it does
 * not fire on unrelated words; the rest are distinctive enough to match raw.
 */
const CENTREPIECE =
  /biff|beef|steak|entrecote|indrefilet|ytrefilet|karbonad|patties|patty|kylling|chicken|kalkun|turkey|svin|pork|pulled|\blam\b|lamme|lamb|reinsdyr|elg|moose|torsk|cod|laks|salmon|rødspette|plaice|stenbit|fiskekake|stroganoff|gyros|wings|coq au vin|panert|breaded|schnitzel|slakterbiff|hanger|kjøtt|meat|bolognese|tortilla|casserole/i;

/** Phrasing that signals a full plate rather than a component. */
const SERVED_WITH =
  /med stekte|with fried|med fløte|with cream|med poteter|with potatoes|med fries|with fries|serveres med|served with|med ris/i;

/** Dishes that are sides even when they read like a meal. Anchored to the start. */
const LIGHT_SIDE =
  /^stekt ris|^fried rice|^couscous|^nudler|^noodles|^falafel|^linsegryte|^lentil|^bønnegryte|^bean stew|^sopprisotto|^mushroom risotto/i;

/**
 * Higher score = more likely to be the main dish. Scores are relative only;
 * the absolute values carry no meaning beyond their ordering.
 */
export function scoreMainDish(dish: string, canteenName: string): number {
  const lower = (dish || "").toLowerCase();
  if (!lower) return -1000;

  // Hard rule: this canteen's daily pizza is never the headline.
  if (canteenName === PIZZA_IS_NEVER_MAIN_AT && lower.includes("pizza")) return -100;

  let score = 0;
  if (lower.includes("pizza")) score -= 80;
  if (lower.includes("suppe") || lower.includes("soup")) score -= 50;
  if (CENTREPIECE.test(lower)) score += 50;
  if (SERVED_WITH.test(lower)) score += 30;
  if (LIGHT_SIDE.test(lower)) score -= 30;
  return score;
}

/**
 * Orders items best-main-first and flags the winner. Ties keep their original
 * relative order, so the canteen's own listing order breaks ties — that is
 * usually the order the kitchen considers meaningful.
 */
export function rankItems(rawItems: MenuItem[] | undefined, canteenName: string): MenuItem[] {
  if (!rawItems || rawItems.length === 0) return [];
  return rawItems
    .map((item, idx) => ({ item, idx, score: scoreMainDish(item.dish, canteenName) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map(({ item }, idx) => ({ ...item, isMain: idx === 0 }));
}

/** The single dish the day should be represented by, or undefined if none. */
export function pickMainDish(
  rawItems: MenuItem[] | undefined,
  canteenName: string
): MenuItem | undefined {
  return rankItems(rawItems, canteenName)[0];
}
