import type { MenuItem, DishCourse } from "./types";
import { courseOverride } from "./dish-course-overrides";

/**
 * Single source of truth for "which of today's dishes is the main dish".
 *
 * The ranking is by course tier, best first: a meat/fish plate with sides, a hot
 * dish with meat or fish mixed in (wok, pasta, stew), a vegetarian hot dish, a
 * soup, then pizza/salad/sides. A soup therefore never beats a plated dish, and
 * a vegetarian dish only wins when nothing with meat or fish is on the board.
 *
 * Where a dish's course comes from, in order: the label Gemini stored for it in
 * dish_cache (passed in by the updater), otherwise `guessCourse` below. The
 * guess is what keeps a day sane when the model was unreachable or has not seen
 * a dish yet; it is why the word lists here are still worth maintaining.
 *
 * The decision is made once, by the updater, and stored as `isMain` with the
 * items in ranked order. Everyone else (the server, the client, the image job)
 * reads that: `rankItems` returns already-decided items untouched. Before this,
 * several copies re-ranked independently and could disagree about the winner,
 * which shows up as a photo of the wrong food.
 */

/** Canteen whose pizza is a permanent fixture, never the dish of the day. */
const PIZZA_IS_NEVER_MAIN_AT = "Eat the street";

/**
 * Centrepiece proteins and composed mains. `lam` needs a boundary so it does
 * not fire on unrelated words; the rest are distinctive enough to match raw.
 */
const CENTREPIECE =
  /biff|beef|steak|entrecote|indrefilet|ytrefilet|karbonad|patties|patty|kylling|chicken|kalkun|turkey|svin|pork|pulled|\blam\b|lamme|lamb|reinsdyr|elg|moose|torsk|cod|laks|salmon|rødspette|plaice|stenbit|steinbit|fiskekake|stroganoff|gyros|wings|coq au vin|panert|breaded|schnitzel|slakterbiff|hanger|kjøtt|meat|bolognese|tortilla|casserole|hyse|haddock|kveite|halibut|ørret|trout|aure|makrell|mackerel|\bsild|herring|reker|shrimp|scampi|skrei|breiflabb|tunfisk|tuna|fisk|fish|skinke|ham\b|bacon|pølse|sausage|burger|ribbe|pinnekjøtt|mørbrad|kotelett|cutlet|medister|fenalår|duck|andebryst|kamskjell|scallop|blåskjell|mussel|krabbe|crab/i;

/** Short words that need a whole-word match (a substring would fire on far too much). */
const CENTREPIECE_WORDS = new Set(["sei", "and", "hjort", "vilt", "okse"]);

/** Hot dishes where the protein is mixed in rather than sitting on a plate. */
const MIXED =
  /wok|gryte|stew|pasta|curry|karri|lasagne|burger|taco|tortilla|bolognese|stroganoff|casserole|risotto|gulasj|goulash|jambalaya|paella|stekt ris|fried rice|nudler|noodles|biryani|masala|tikka/i;

/** Phrasing that signals a full plate rather than a component. */
const SERVED_WITH =
  /med stekte|with fried|med fløte|with cream|med poteter|with potatoes|med fries|with fries|serveres med|served with|med ris/i;

/** Dishes that are sides even when they read like a meal. Anchored to the start. */
const LIGHT_SIDE = /^stekt ris|^fried rice|^couscous|^nudler|^noodles/i;

/** Meatless dishes. */
const VEG =
  /vegetar|vegan|veggie|grønnsak|vegetable|grøt|porridge|linse|lentil|bønne|bean|kikert|chickpea|falafel|tofu|tempeh|sopp|mushroom|blomkål|cauliflower|aubergine|eggplant|halloumi|quinoa|hummus|spinat|squash|søtpotet|sweet potato|gnocchi/i;

/** Not a dish of the day: salad, bread, dessert, and pizza. */
const SIDE = /pizza|salat|salad|dessert|kake\b|cake|brød|bread|frukt|fruit|yoghurt|yogurt/i;

/** Score per course, best first. The gaps are wider than the composed bonus below. */
const COURSE_SCORE: Record<DishCourse, number> = {
  meat_plate: 80,
  meat_mixed: 50,
  veg: 0,
  soup: -50,
  side: -80,
};

/** A hot dish no rule recognised: between a mixed dish and a vegetarian one. */
const UNKNOWN_HOT_SCORE = 20;

function words(lower: string): string[] {
  return lower.split(/[^a-zæøåéèêô]+/).filter(Boolean);
}

/**
 * Rules that outrank a stored model label, for the few patterns the name settles
 * beyond doubt and the model has been seen to get wrong: a salad labelled as a
 * meat dish because it carries chicken, a "vegangulasj" labelled as stew with
 * meat. A salad is only a side when it is the head of the dish; "Svinekam med
 * linsesalat" is a pork plate with a salad beside it.
 */
function forcedCourse(lower: string): DishCourse | null {
  if (lower.includes("suppe") || lower.includes("soup")) return "soup";
  if (lower.includes("pizza")) return "side";
  const head = lower.split(/\s+(?:med|with)\s+/)[0];
  if (/salat|salad/.test(head)) return "side";
  if (/\bvegan|\bvegetar|\bveggie/.test(lower)) return "veg";
  return null;
}

/**
 * The course of a dish from its name alone, or null when no rule recognises it.
 * Soup is checked first so "Kalkunsuppe" is a soup, not a turkey dish.
 */
export function guessCourse(dish: string): DishCourse | null {
  const lower = (dish || "").toLowerCase();
  if (!lower) return null;
  const forced = forcedCourse(lower);
  if (forced) return forced;
  if (LIGHT_SIDE.test(lower)) return "side";

  const meat = CENTREPIECE.test(lower) || words(lower).some((w) => CENTREPIECE_WORDS.has(w));
  if (SIDE.test(lower) && !meat) return "side";
  if (meat) return MIXED.test(lower) ? "meat_mixed" : "meat_plate";
  if (VEG.test(lower)) return "veg";
  return null;
}

/** More composed (protein plus sides, "med ... og ...") breaks a tie inside a tier. */
function composedBonus(lower: string): number {
  const parts = (lower.match(/\bmed\b|\bwith\b|\bog\b|\band\b|,/g) ?? []).length;
  return Math.min(parts, 2) * 5 + (SERVED_WITH.test(lower) ? 5 : 0);
}

/**
 * Higher score = more likely to be the main dish. Scores are relative only;
 * the absolute values carry no meaning beyond their ordering.
 *
 * `course` is the stored label for this dish when there is one; without it the
 * name is guessed. A hand-set override (dish-course-overrides.ts) beats both.
 */
export function scoreMainDish(dish: string, canteenName: string, course?: DishCourse | null): number {
  const lower = (dish || "").toLowerCase();
  if (!lower) return -1000;

  // Hard rule: this canteen's daily pizza is never the headline.
  if (canteenName === PIZZA_IS_NEVER_MAIN_AT && lower.includes("pizza")) return -100;

  const resolved = courseOverride(dish) ?? forcedCourse(lower) ?? course ?? guessCourse(dish);
  const base = resolved ? COURSE_SCORE[resolved] : UNKNOWN_HOT_SCORE;
  // The bonus is at most 15 and the smallest gap between tiers is 20, so it can
  // only ever break a tie inside one tier.
  return base + composedBonus(lower);
}

/** Dish name -> stored course label. */
export type CourseLabels = Record<string, DishCourse | undefined>;

/**
 * Orders items best-main-first and flags the winner. Ties keep their original
 * relative order, so the canteen's own listing order breaks ties.
 *
 * Items that already carry a decided winner (`isMain` set on any of them) are
 * returned as they are: the updater ranked them with the model's labels and
 * stored the result, and re-ranking by name alone would undo it. The updater
 * passes `labels` to force a fresh ranking; fresh scraper output has no
 * `isMain` yet, so it is ranked too.
 */
export function rankItems(
  rawItems: MenuItem[] | undefined,
  canteenName: string,
  labels?: CourseLabels
): MenuItem[] {
  if (!rawItems || rawItems.length === 0) return [];
  if (!labels && rawItems.some((i) => i.isMain)) return rawItems;
  return rawItems
    .map((item, idx) => ({ item, idx, score: scoreMainDish(item.dish, canteenName, labels?.[item.dish]) }))
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
