export interface Allergen { id: string; name: string; }
export interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
export interface DayMenu { label: string; items: MenuItem[]; }
export interface DayEntry { day: string; no: DayMenu; en: DayMenu; }
export interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
export interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

export interface RecipeIngredient { amount: string; unit: string; item: string; }
export interface Recipe { title: string; servings: number; prepTime: string; cookTime: string; ingredients: RecipeIngredient[]; steps: string[]; tip?: string; }

export interface ProductOffer {
  id: string;
  name: string;
  brand: string | null;
  price: number;
  unitPrice: number | null;
  imageUrl: string | null;
  store: string;
  storeCode: string;
  storeColor: string;
  storeLogo: string;
  matchedIngredient: string;
  productUrl: string | null;
  weight: string | null;
}

export interface StoreRecommendation {
  store: string;
  storeColor: string;
  storeLogo: string;
  totalPrice: number;
  dealCount: number;
  keyIngredientsCovered: number;
  deals: ProductOffer[];
}

export interface DealsResponse {
  recommendation: StoreRecommendation;
  allStores: StoreRecommendation[];
  searchedIngredients: string[];
  generatedAt: string;
}

export interface MenyProduct {
  ean: string;
  name: string;
  subtitle: string;
  brand: string;
  price: number;
  pricePerUnit: string | null;
  imageUrl: string | null;
  weight: string | null;
  productUrl: string | null;
}

export interface MenyIngredientMatch {
  ingredient: string;
  searchTerm: string;
  product: MenyProduct | null;
  alternatives: MenyProduct[];
  matched: boolean;
  outOfStock?: boolean; // true when matched only via out-of-stock product
}

export interface MenyResponse {
  storeId: string;
  storeName: string;
  matches: MenyIngredientMatch[];
  totalPrice: number;
  matchedCount: number;
  totalCount: number;
  allMatched: boolean;
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
