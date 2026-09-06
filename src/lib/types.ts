export interface Allergen { id: string; name: string; }
export interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
export interface DayMenu { label: string; items: MenuItem[]; availabilityNotes?: string[]; }
// `no` and `en` are optional because the widget genuinely publishes days in
// only one language — see the scraper test of the same name. Declaring them
// required made every `dayItem.no?.items` guard in the pipeline look like
// defensive paranoia rather than the load-bearing check it is.
export interface DayEntry { day: string; no?: DayMenu; en?: DayMenu; }
export interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
export interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

export interface DishOrigin { code: string; country: string; }
export interface DishDescription { en?: string; no?: string; }

export interface WeeklyMenuRecord {
  weekId: string;
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  /**
   * Dish name -> a shortened form of it, for the card's headline only.
   *
   * Only present for names too long to fit the headline in two lines; the rest
   * render as they are. A value equal to its key means the model was asked and
   * had nothing shorter to offer, which renders identically and stops the dish
   * being re-asked every run.
   *
   * Deliberately a side map rather than a rewrite of the dish name: that name
   * is the dish_cache key, what a plate image is archived under, and what the
   * recipe generator is asked about, so it must not move.
   */
  dishShortNames: Record<string, string>;
  scrapedAt: string;
}

export interface CanteenDayItem {
  canteenName: string;
  canteen: CanteenData;
  dayEntry?: DayEntry;
  items?: MenuItem[];
  mainDish?: MenuItem;
  sideDishes?: MenuItem[];
  mainAllergens?: Allergen[];
  imageSlug?: string;
  imagePath?: string;
  highResImagePath?: string;
  isOutdated?: boolean;
  isAhead?: boolean;
  canteenWeekNum?: number;
  origin?: DishOrigin | null;
  description?: string | null;
  /**
   * What the card's headline should say. Equals `mainDish.dish` unless the
   * enricher produced something shorter for a name too long to fit. The full
   * name stays on `mainDish` and is what the lightbox, the action sheet and
   * the recipe use.
   */
  displayDishName?: string | null;
  availabilityNotes?: string[];
}

export interface RecipeIngredient { amount: string; unit: string; item: string; itemLocal?: string; }
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
  isCampaign: boolean;
  originalPrice: number | null;
  savingsPercent: number | null;
  validUntil: string | null;
  source: 'kassal' | 'tjek';
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
  categoryName?: string | null;
  isOffer?: boolean;
  productUrl?: string | null;
}

export interface MenyIngredientMatch {
  ingredient: string;
  searchTerm?: string;
  queryUsed?: string;
  matched?: boolean;
  outOfStock?: boolean;
  pantryStaple?: boolean;
  recipeAmount?: string;
  recipeUnit?: string;
  product?: MenyProduct | null;
  bestMatch?: MenyProduct | null;
  alternatives?: MenyProduct[];
}

export interface MenyResponse {
  dishName: string;
  matches: MenyIngredientMatch[];
  totalPrice: number;
  totalCount?: number;
  matchedCount: number;
  searchedCount: number;
  allMatched?: boolean;
  store: string;
  storeId?: string;
  storeName?: string;
  storeColor: string;
  storeLogo: string;
  generatedAt: string;
}
