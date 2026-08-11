import type { CanteenDayItem, MenuItem } from "@/lib/types";

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

/** Ranks menu items to determine the true main dish (excluding pizzas from Eat the street, soups, and light sides). */
export function scoreMainDish(dish: string, canteenName: string): number {
  let score = 0;
  const lower = dish.toLowerCase();

  // Rule 1: Pizza is NEVER the main dish for Eat the street
  if (canteenName === "Eat the street" && lower.includes("pizza")) {
    return -100;
  }
  if (lower.includes("pizza")) score -= 80;

  // Rule 2: Soups are side dishes
  if (lower.includes("suppe") || lower.includes("soup")) score -= 50;

  // Rule 3: Heavy protein / centerpiece main dish boost (NO & EN)
  if (
    /biff|beef|steak|karbonad|patties|patty|kylling|chicken|svin|pork|torsk|cod|laks|salmon|rødspette|plaice|elg|moose|stroganoff|gyros|wings|coq au vin|panert|breaded|slakterbiff|hanger|kjøtt|meat|bolognese|tortilla|casserole/i.test(
      lower
    )
  ) {
    score += 50;
  }

  // Rule 4: Complete meals with sides (NO & EN)
  if (
    /med stekte|with fried|med fløte|with cream|med poteter|with potatoes|med fries|with fries|serveres med|served with|med ris/i.test(
      lower
    )
  ) {
    score += 30;
  }

  // Rule 5: Pure vegetarian sides penalty unless it's the only option
  if (
    /^stekt ris|^fried rice|^couscous|^nudler|^noodles|^falafel|^linsegryte|^lentil|^bønnegryte|^bean stew|^sopprisotto|^mushroom risotto/i.test(
      lower
    )
  ) {
    score -= 30;
  }

  return score;
}

/** Returns items with the true Main Dish at index 0 marked with isMain: true. */
export function getRankedItems(rawItems: MenuItem[] | undefined, canteenName: string): MenuItem[] {
  if (!rawItems || rawItems.length === 0) return [];
  const copy = [...rawItems];
  copy.sort((a, b) => {
    const scoreA = scoreMainDish(a.dish, canteenName);
    const scoreB = scoreMainDish(b.dish, canteenName);
    return scoreB - scoreA;
  });
  return copy.map((item, idx) => ({
    ...item,
    isMain: idx === 0,
  }));
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
