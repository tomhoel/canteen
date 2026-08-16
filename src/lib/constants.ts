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
  "Eat the street": "eat_the_street", "Fresh4you": "fresh4you", "Flow": "flow"
};

// Hardcoded fallback so client-side image URLs work even when Vercel's
// NEXT_PUBLIC_SUPABASE_URL env var is missing at build time.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sloutnqpqfesyoycklgd.supabase.co';
export const SUPABASE_STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public`;

/**
 * Two different endpoints, and picking the wrong one silently costs 60× the bytes.
 *
 * `/object/public` serves the stored file and ignores `?width`/`?format`
 * entirely — it answers 200 with the original, so nothing looks broken. Only
 * `/render/image/public` applies the transformation. Every plate the app
 * renders was asking for a 440px WebP and being handed the source PNG:
 * 1,490,718 bytes against 24,298 transformed. Three cards on screen plus the
 * adjacent-day preload made that ~13 MB per day browsed, on a phone.
 *
 * `resize=contain` is not optional. The render endpoint defaults to `cover`,
 * and with a width but no height that crops rather than scales: the same plate
 * comes back 440×1021 out of a 1024×1021 source — a vertical slice with the
 * left and right thirds of the food cut off. With `contain` it is 440×439, the
 * whole plate, and smaller again.
 *
 * Untransformed requests still go to `/object/public`, which is free and
 * cacheable; only sized requests take the render path.
 */
export function getSupabaseImageUrl(bucket: string, path: string, options?: { width?: number; height?: number; format?: string; quality?: number }) {
  const params = new URLSearchParams();
  if (options?.width) params.set('width', options.width.toString());
  if (options?.height) params.set('height', options.height.toString());
  if (options?.format) params.set('format', options.format);
  if (options?.quality) params.set('quality', options.quality.toString());

  if ([...params.keys()].length === 0) return `${SUPABASE_STORAGE_URL}/${bucket}/${path}`;

  params.set('resize', 'contain');
  return `${SUPABASE_URL}/storage/v1/render/image/public/${bucket}/${path}?${params.toString()}`;
}

/**
 * Closed canteens render one of 3 cutlery-and-napkin designs hosted at
 * `images_nobg/closed-plates/`. The variant is picked deterministically
 * from the seed so the same canteen+day always shows the same plate.
 */
export function getClosedPlateUrl(seed: string, options?: { width?: number; height?: number; format?: string; quality?: number }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) | 0;
  const variant = (Math.abs(hash) % 3) + 1;
  return getSupabaseImageUrl('images_nobg', `closed-plates/closed-plate-${variant}.png`, options);
}
