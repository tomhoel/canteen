export interface Allergen { id: string; name: string; }
export interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
export interface DayMenu { label: string; items: MenuItem[]; availabilityNotes?: string[]; }
// `no` and `en` are optional because the widget genuinely publishes days in
// only one language — see the scraper test of the same name. Declaring them
// required made every `dayItem.no?.items` guard in the pipeline look like
// defensive paranoia rather than the load-bearing check it is.
export interface DayEntry { day: string; no?: DayMenu; }
export interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
export interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

export interface DishOrigin { code: string; country: string; }

/**
 * What kind of dish this is, for picking the day's headline. Best to worst:
 * a meat/fish plate with sides, a hot dish with meat or fish mixed in (wok,
 * pasta, stew, curry), a vegetarian hot dish, a soup, then pizza/salad/sides.
 */
export type DishCourse = "meat_plate" | "meat_mixed" | "veg" | "soup" | "side";
export const DISH_COURSES: readonly DishCourse[] = ["meat_plate", "meat_mixed", "veg", "soup", "side"];

export interface WeeklyMenuRecord {
  weekId: string;
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
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
  imagePath?: string;
  highResImagePath?: string;
  isOutdated?: boolean;
  isAhead?: boolean;
  canteenWeekNum?: number;
  origin?: DishOrigin | null;
  /**
   * What the card's headline should say. Equals `mainDish.dish` unless the
   * enricher produced something shorter for a name too long to fit. The full
   * name stays on `mainDish` and is what the lightbox, the action sheet and
   * the recipe use.
   */
  displayDishName?: string | null;
  availabilityNotes?: string[];
}
