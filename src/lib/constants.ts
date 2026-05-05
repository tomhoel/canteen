export const DAYS_NO = ["Man", "Tir", "Ons", "Tor", "Fre"];
export const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const FULL_DAYS_NO = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"];
export const FULL_DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
export const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

export const ALLERGEN_COLORS: Record<string, string> = {
  Egg: "#FF9500", Fish: "#30B0C7", Gluten: "#FFCC00", Milk: "#8E8E93",
  Nuts: "#A05A2C", Peanuts: "#A05A2C", Celery: "#34C759", Mustard: "#FFCC00",
  "Sesame seeds": "#C7A000", Shellfish: "#FF3B30", Soya: "#5856D6",
  Sulphites: "#AF52DE", Molluscs: "#5AC8FA", Lupin: "#34C759"
};

export const ALLERGEN_NAMES_NO: Record<string, string> = {
  Egg: "Egg", Fish: "Fisk", Gluten: "Gluten", Milk: "Melk",
  Nuts: "N\u00F8tter", Peanuts: "Pean\u00F8tter", Celery: "Selleri", Mustard: "Sennep",
  "Sesame seeds": "Sesamfr\u00F8", Shellfish: "Skalldyr", Soya: "Soya",
  Sulphites: "Sulfitter", Molluscs: "Bl\u00F8tdyr", Lupin: "Lupin"
};

/** Short allergen abbreviations — unique 2-3 letter codes to avoid collisions. */
export const ALLERGEN_ABBREV: Record<string, string> = {
  Egg: "Eg", Fish: "Fi", Gluten: "Gl", Milk: "Mi",
  Nuts: "Nø", Peanuts: "Pn", Celery: "Se", Mustard: "Sn",
  "Sesame seeds": "Ss", Shellfish: "Sk", Soya: "So",
  Sulphites: "Su", Molluscs: "Bl", Lupin: "Lu",
};

/** Norwegian abbreviations for allergens on side dishes. */
export const ALLERGEN_ABBREV_NO: Record<string, string> = {
  Egg: "Eg", Fish: "Fi", Gluten: "Gl", Milk: "Me",
  Nuts: "Nø", Peanuts: "Pn", Celery: "Se", Mustard: "Sn",
  "Sesame seeds": "Ss", Shellfish: "Sk", Soya: "So",
  Sulphites: "Su", Molluscs: "Bl", Lupin: "Lu",
};

export const CANTEEN_ORDER = ["Eat the street", "Fresh4you", "Flow"];

export const CANTEEN_IMAGE_SLUGS: Record<string, string> = {
  \"Eat the street\": \"eat_the_street\", \"Fresh4you\": \"fresh4you\", \"Flow\": \"flow\"
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_STORAGE_URL = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public` : null;

export function getSupabaseImageUrl(bucket: string, path: string, options?: { width?: number; height?: number; format?: string; quality?: number }) {
  if (!SUPABASE_STORAGE_URL) return null;
  const url = `${SUPABASE_STORAGE_URL}/${bucket}/${path}`;
  if (!options) return url;
  
  const params = new URLSearchParams();
  if (options.width) params.set('width', options.width.toString());
  if (options.height) params.set('height', options.height.toString());
  if (options.format) params.set('format', options.format);
  if (options.quality) params.set('quality', options.quality.toString());
  
  const queryString = params.toString();
  return queryString ? `${url}?${queryString}` : url;
}
