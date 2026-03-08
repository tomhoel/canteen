export interface Allergen { id: string; name: string; }
export interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
export interface DayMenu { label: string; items: MenuItem[]; }
export interface DayEntry { day: string; no: DayMenu; en: DayMenu; }
export interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
export interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

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
