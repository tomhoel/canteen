import { STORAGE_BASE_URL } from './storage-url';
export const DAYS_NO = ["Man", "Tir", "Ons", "Tor", "Fre"];
export const FULL_DAYS_NO = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"];
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

/** Norwegian abbreviations for allergens on side dishes. */
export const ALLERGEN_ABBREV_NO: Record<string, string> = {
  Egg: "Eg", Fish: "Fi", Gluten: "Gl", Milk: "Me",
  Nuts: "Nø", Peanuts: "Pn", Celery: "Se", Mustard: "Sn",
  "Sesame seeds": "Ss", Shellfish: "Sk", Soya: "So",
  Sulphites: "Su", Molluscs: "Bl", Lupin: "Lu",
};

export const CANTEEN_ORDER = ["Eat the street", "Fresh4you", "Flow"];

export interface CanteenLocationInfo {
  id: string;
  canonicalKey: string;
  name: string;
  shortName: string;
  subName?: string;
  building: string;
  buildingShort: string;
  buildingCode: string;
  floor: string;
  hours: string;
  lunchHours?: string;
  type: "canteen" | "bakery" | "cafe" | "dinner";
  coordinates: { x: number; y: number };
  color: string;
  darkColor: string;
  badgeBg: string;
  badgeBorder: string;
  description: { no: string };
  specialNote?: { no: string };
  hasMenu: boolean;
}

export const CANTEEN_LOCATIONS: CanteenLocationInfo[] = [
  {
    id: "street",
    canonicalKey: "Eat the street",
    name: "Eat The Street",
    shortName: "Eat The Street",
    building: "Bygg J/K",
    buildingShort: "J/K",
    buildingCode: "J/K",
    floor: "1. etasje",
    hours: "10:30 – 14:00",
    type: "canteen",
    coordinates: { x: 30, y: 80 },
    color: "#2563eb",
    darkColor: "#60a5fa",
    badgeBg: "rgba(37, 99, 235, 0.12)",
    badgeBorder: "rgba(37, 99, 235, 0.28)",
    description: {
      no: "Hovedkantinen i Bygg J/K med varmmat, buffet, salatbar og middagstilbud.",
    },
    specialNote: {
      no: "Middagsservering mandag–torsdag kl. 15:00–17:00.",
    },
    hasMenu: true,
  },
  {
    id: "fresh4you",
    canonicalKey: "Fresh4you",
    name: "Fresh 4 You",
    shortName: "Fresh 4 You",
    building: "Bygg C/D",
    buildingShort: "C/D",
    buildingCode: "C/D",
    floor: "1. etasje",
    hours: "10:30 – 13:00",
    type: "canteen",
    coordinates: { x: 78, y: 21 },
    color: "#059669",
    darkColor: "#34d399",
    badgeBg: "rgba(5, 150, 105, 0.12)",
    badgeBorder: "rgba(5, 150, 105, 0.28)",
    description: {
      no: "Kantine i Bygg C/D med fokus på ferske råvarer, sunne retter og salater.",
    },
    hasMenu: true,
  },
  {
    id: "m",
    canonicalKey: "Flow",
    name: "Kantine M",
    shortName: "Kantine M",
    subName: "Tidligere Flow",
    building: "Bygg M, 2. etasje",
    buildingShort: "M (2. etg)",
    buildingCode: "M",
    floor: "2. etasje",
    hours: "10:30 – 13:00",
    type: "canteen",
    coordinates: { x: 74, y: 56 },
    color: "#0891b2",
    darkColor: "#22d3ee",
    badgeBg: "rgba(8, 145, 178, 0.12)",
    badgeBorder: "rgba(8, 145, 178, 0.28)",
    description: {
      no: "Kantine i 2. etasje i Bygg M med variert varmmatmeny og lunsjretter.",
    },
    hasMenu: true,
  },
  {
    id: "bakern",
    canonicalKey: "Bakern",
    name: "Bakern",
    shortName: "Bakern",
    building: "Bygg C",
    buildingShort: "C",
    buildingCode: "C",
    floor: "1. etasje",
    hours: "07:00 – 15:00",
    lunchHours: "10:30 – 13:00",
    type: "bakery",
    coordinates: { x: 61, y: 21 },
    color: "#d97706",
    darkColor: "#fbbf24",
    badgeBg: "rgba(217, 119, 6, 0.12)",
    badgeBorder: "rgba(217, 119, 6, 0.28)",
    description: {
      no: "Nystekt brød, ferske bakevarer, sandwicher og varm lunsjrett.",
    },
    specialNote: {
      no: "Bakevarer hele dagen (07:00–15:00). Varm lunsjrett serveres 10:30–13:00.",
    },
    hasMenu: false,
  },
  {
    id: "expo",
    canonicalKey: "Café Expo",
    name: "Café Expo",
    shortName: "Café Expo",
    building: "Bygg A / Expo",
    buildingShort: "A / Expo",
    buildingCode: "A",
    floor: "1. etasje",
    hours: "08:00 – 15:00",
    type: "cafe",
    coordinates: { x: 86, y: 30 },
    color: "#7c3aed",
    darkColor: "#a78bfa",
    badgeBg: "rgba(124, 58, 237, 0.12)",
    badgeBorder: "rgba(124, 58, 237, 0.28)",
    description: {
      no: "Kaffebar og møtested i Expo-bygget med barista-kaffe, bakverk og snacks.",
    },
    specialNote: {
      no: "☕ Fredager: Gratis kaffe frem til kl. 11:00 for Telenor-ansatte!",
    },
    hasMenu: false,
  },
  {
    id: "hotspot",
    canonicalKey: "Hot Spot",
    name: "Hot Spot",
    shortName: "Hot Spot",
    building: "Bygg G",
    buildingShort: "G",
    buildingCode: "G",
    floor: "1. etasje",
    hours: "07:30 – 14:30",
    type: "cafe",
    coordinates: { x: 45, y: 50 },
    color: "#db2777",
    darkColor: "#f472b6",
    badgeBg: "rgba(219, 39, 119, 0.12)",
    badgeBorder: "rgba(219, 39, 119, 0.28)",
    description: {
      no: "Populær kaffebar og uformelt møtested midt i Bygg G ved torget.",
    },
    hasMenu: false,
  },
  {
    id: "cafem",
    canonicalKey: "Cafe M",
    name: "Cafe M",
    shortName: "Cafe M",
    building: "Bygg M",
    buildingShort: "M (1. etg)",
    buildingCode: "M",
    floor: "1. etasje",
    hours: "08:30 – 15:30",
    type: "cafe",
    coordinates: { x: 68, y: 63 },
    color: "#0d9488",
    darkColor: "#2dd4bf",
    badgeBg: "rgba(13, 148, 136, 0.12)",
    badgeBorder: "rgba(13, 148, 136, 0.28)",
    description: {
      no: "Kaffebar og pauseområde i 1. etasje i Bygg M under kantinen.",
    },
    hasMenu: false,
  },
  {
    id: "dinner",
    canonicalKey: "Eat The Street Middag",
    name: "Eat The Street – Middag",
    shortName: "Middag",
    building: "Bygg J/K",
    buildingShort: "J/K",
    buildingCode: "J/K",
    floor: "1. etasje",
    hours: "15:00 – 17:00",
    type: "dinner",
    coordinates: { x: 30, y: 80 },
    color: "#ea580c",
    darkColor: "#fb923c",
    badgeBg: "rgba(234, 88, 12, 0.12)",
    badgeBorder: "rgba(234, 88, 12, 0.28)",
    description: {
      no: "Middagsservering mandag til torsdag i Eat The Street for overtidsarbeidende og ettermiddagsgjester.",
    },
    specialNote: {
      no: "Serveres mandag–torsdag kl. 15:00–17:00 (stengt fredager).",
    },
    hasMenu: false,
  },
];

const CANTEEN_METADATA_MAP: Record<string, CanteenLocationInfo> = {};
for (const loc of CANTEEN_LOCATIONS) {
  CANTEEN_METADATA_MAP[loc.id.toLowerCase()] = loc;
  CANTEEN_METADATA_MAP[loc.name.toLowerCase()] = loc;
  CANTEEN_METADATA_MAP[loc.canonicalKey.toLowerCase()] = loc;
  CANTEEN_METADATA_MAP[loc.shortName.toLowerCase()] = loc;
}
// Add explicit aliases
CANTEEN_METADATA_MAP["flow"] = CANTEEN_LOCATIONS[2];
CANTEEN_METADATA_MAP["kantine m"] = CANTEEN_LOCATIONS[2];
CANTEEN_METADATA_MAP["bygg m"] = CANTEEN_LOCATIONS[2];
CANTEEN_METADATA_MAP["fresh4you"] = CANTEEN_LOCATIONS[1];
CANTEEN_METADATA_MAP["fresh 4 you"] = CANTEEN_LOCATIONS[1];
CANTEEN_METADATA_MAP["telenor expo"] = CANTEEN_LOCATIONS[1];
CANTEEN_METADATA_MAP["eat the street"] = CANTEEN_LOCATIONS[0];
CANTEEN_METADATA_MAP["the hub"] = CANTEEN_LOCATIONS[0];
CANTEEN_METADATA_MAP["street"] = CANTEEN_LOCATIONS[0];
CANTEEN_METADATA_MAP["cafe expo"] = CANTEEN_LOCATIONS[4];
CANTEEN_METADATA_MAP["café expo"] = CANTEEN_LOCATIONS[4];
CANTEEN_METADATA_MAP["expo"] = CANTEEN_LOCATIONS[4];
CANTEEN_METADATA_MAP["hot spot"] = CANTEEN_LOCATIONS[5];
CANTEEN_METADATA_MAP["hotspot"] = CANTEEN_LOCATIONS[5];
CANTEEN_METADATA_MAP["cafe m"] = CANTEEN_LOCATIONS[6];
CANTEEN_METADATA_MAP["cafem"] = CANTEEN_LOCATIONS[6];
CANTEEN_METADATA_MAP["bakern"] = CANTEEN_LOCATIONS[3];
CANTEEN_METADATA_MAP["bakeren"] = CANTEEN_LOCATIONS[3];
CANTEEN_METADATA_MAP["middag"] = CANTEEN_LOCATIONS[7];
CANTEEN_METADATA_MAP["dinner"] = CANTEEN_LOCATIONS[7];

export function getCanteenMetadata(rawName?: string): CanteenLocationInfo {
  if (!rawName) return CANTEEN_LOCATIONS[0];
  const cleaned = rawName.trim().toLowerCase();
  if (CANTEEN_METADATA_MAP[cleaned]) return CANTEEN_METADATA_MAP[cleaned];
  if (cleaned.includes("street") || cleaned.includes("hub")) return CANTEEN_LOCATIONS[0];
  if (cleaned.includes("fresh")) return CANTEEN_LOCATIONS[1];
  if (/\b(flow|kantine\s*m)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[2];
  if (/\b(bakern|bakeren|bakeri)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[3];
  if (/\b(expo)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[4];
  if (/\b(hot\s*spot)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[5];
  if (/\b(caf[eé]\s*m)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[6];
  if (/\b(middag|dinner)\b/i.test(cleaned)) return CANTEEN_LOCATIONS[7];
  if (/\bbygg\s*m\b/i.test(cleaned)) return CANTEEN_LOCATIONS[2];

  return {
    id: cleaned.replace(/\s+/g, "_"),
    canonicalKey: rawName,
    name: rawName,
    shortName: rawName,
    building: "Snarøyveien 30",
    buildingShort: "FBU",
    buildingCode: "",
    floor: "1. etasje",
    hours: "10:30 – 13:00",
    type: "canteen",
    coordinates: { x: 50, y: 50 },
    color: "#6b7280",
    darkColor: "#9ca3af",
    badgeBg: "rgba(107, 114, 128, 0.12)",
    badgeBorder: "rgba(107, 114, 128, 0.28)",
    description: { no: "Kantine på Fornebu" },
    hasMenu: true,
  };
}

/**
 * Width a card plate is asked for, by tier. Storage does not resize on request, so
 * the number only selects the pre-made 512px thumb (see getImageUrl);
 * the tiers stay separate because HomeClient also keys its preload cache on it.
 */
export const PLATE_CARD_WIDTH = { mobile: 340, desktop: 640 } as const;

/**
 * URL of a stored image (Supabase Storage; see storage-url.ts).
 *
 * Storage serves the object as written and ignores transforms, so the only
 * "resize" on offer is the thumb the updater writes beside every plate:
 * a card-sized `width` (<= PLATE_CARD_WIDTH.desktop) in `images_nobg` maps to
 * `images_nobg/thumb/<path>`; anything larger, or no width, is the full plate.
 */
export function getImageUrl(
  bucket: string,
  path: string,
  options?: { width?: number }
) {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  const encodedPath = path.split("/").map(encodeURIComponent).join("/");

  if (bucket === 'images_nobg' && options?.width && options.width <= PLATE_CARD_WIDTH.desktop) {
    return `${STORAGE_BASE_URL}/${bucket}/thumb/${encodedPath}`;
  }

  return `${STORAGE_BASE_URL}/${bucket}/${encodedPath}`;
}

/**
 * Closed canteens render one of 3 cutlery-and-napkin designs hosted at
 * `images_nobg/closed-plates/`. The variant is picked deterministically
 * from the seed so the same canteen+day always shows the same plate.
 */
export function getClosedPlateUrl(seed: string, options?: { width?: number }) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) | 0;
  const variant = (Math.abs(hash) % 3) + 1;
  return getImageUrl('images_nobg', `closed-plates/closed-plate-${variant}.png`, options);
}
