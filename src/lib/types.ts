export interface Allergen { id: string; name: string; }
export interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
export interface DayMenu { label: string; items: MenuItem[]; }
export interface DayEntry { day: string; no: DayMenu; en: DayMenu; }
export interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
export interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

export interface RecipeIngredient { amount: string; unit: string; item: string; }
export interface Recipe { title: string; servings: number; prepTime: string; cookTime: string; ingredients: RecipeIngredient[]; steps: string[]; tip?: string; }

export interface TjekOffer {
  id: string;
  heading: string;
  description: string;
  price: number;
  prePrice: number | null;
  currency: string;
  imageUrl: string | null;
  store: string;
  storeColor: string;
  storeLogo: string;
  runTill: string;
  matchedIngredient: string;
}

export interface StoreRecommendation {
  store: string;
  storeColor: string;
  storeLogo: string;
  totalPrice: number;
  dealCount: number;
  keyIngredientsCovered: number;
  deals: TjekOffer[];
}

export interface DealsResponse {
  recommendation: StoreRecommendation;
  allStores: StoreRecommendation[];
  searchedIngredients: string[];
  generatedAt: string;
}

export interface CanteenDayItem {
  canteenName: string;
  canteen: CanteenData;
  dayEntry: DayEntry | undefined;
  items: MenuItem[] | undefined;
  mainDish: MenuItem | undefined;
  sideDishes: MenuItem[];
  mainAllergens: Allergen[];
  imageSlug: string;
  imagePath: string;
  highResImagePath: string;
  isOutdated: boolean;
  isAhead: boolean;
  canteenWeekNum: number;
  origin: { country: string; code: string } | null;
  description: string | null;
}
