import * as cheerio from "cheerio";
import type { MenuData, CanteenData, MenuItem, Allergen } from "../../lib/types.ts";
import { rankItems, scoreMainDish } from "../../lib/dish-ranking.ts";

// Re-exported so existing importers of the scraper keep working; the single
// implementation now lives in lib/dish-ranking.ts.
export { scoreMainDish };

export interface CanteenConfig {
  name: string;
  token: string;
  hours: string;
  displayName: string;
}

export const CANTEENS: CanteenConfig[] = [
  {
    name: "The Hub",
    token: "6e5cc038-e918-4f97-9a59-d2afa0456abf",
    hours: "11:00 - 13:30",
    displayName: "Eat the street",
  },
  {
    name: "Telenor Expo",
    token: "a8923cdb-9d92-46bc-b6a4-d026c2cf9a89",
    hours: "11:00 - 13:30",
    displayName: "Fresh4you",
  },
  {
    name: "Bygg M",
    token: "756a5aa2-a95f-4d15-ad5a-59829741075b",
    hours: "11:00 - 13:00",
    displayName: "Flow",
  },
];

const DAY_MAP: Record<string, string> = {
  MANDAG: "monday",
  MONDAY: "monday",
  TIRSDAG: "tuesday",
  TUESDAY: "tuesday",
  THUESDAY: "tuesday",
  ONSDAG: "wednesday",
  WEDNESDAY: "wednesday",
  TORSDAG: "thursday",
  THURSDAY: "thursday",
  FREDAG: "friday",
  FRIDAY: "friday",
};

const ALLERGEN_MAP: Record<string, string> = {
  "1": "Egg",
  "2": "Fish",
  "3": "Gluten",
  "4": "Milk",
  "5": "Nuts",
  "6": "Peanuts",
  "7": "Celery",
  "8": "Mustard",
  "9": "Sesame seeds",
  "10": "Shellfish",
  "11": "Soya",
  "12": "Sulphites",
  "13": "Molluscs",
  "14": "Lupin",
};

const MEAT_TAGS = ["svin", "pork", "biff", "beef", "kylling", "chicken", "lam", "lamb", "fisk", "fish"];

const AVAILABILITY_KEYWORDS = [
  "halal",
  "tilgjengelig",
  "available",
  "glutenfri",
  "glutenfree",
  "laktosefri",
  "lactosefree",
  "vegansk",
  "vegan",
  "vegetar",
];

export function extractAvailabilityNote(text: string): string | null {
  const match = text.match(/\(([^)]+)\)/);
  if (!match) return null;
  const inner = match[1].toLowerCase();
  if (AVAILABILITY_KEYWORDS.some((kw) => inner.includes(kw))) {
    return match[1].trim();
  }
  return null;
}

export function isLikelyThemeHeader(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 40) return false;
  if (trimmed !== trimmed.toUpperCase()) return false;
  const words = trimmed.split(/\s+/);
  return (
    words.length <= 4 &&
    !words.some((w) => ALLERGEN_MAP[w]) &&
    !words.some((w) => MEAT_TAGS.includes(w.toLowerCase()))
  );
}

export function splitJammedDishes(text: string): string[] {
  // Split jammed lines where parenthetical allergen numbers like (7) or trailing numbers 1,3 are immediately followed by a new capitalized dish name
  const regex = /(?<=\(\d+(?:[,\s]+\d+)*\)|[\d,]{1,5})(?=[A-ZÆØÅ])/;
  return text
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function parseItem(text: string): MenuItem {
  let dish = text;
  const allergens: Allergen[] = [];

  // Pattern 1: Parenthetical groups — extract allergen numbers, strip meat tags and parens
  dish = dish.replace(/\s*\(([^)]+)\)\s*/g, (_match, inner) => {
    const innerLower = inner.toLowerCase().trim();
    const nums = inner
      .trim()
      .split(/[,\s]+/)
      .map((n: string) => n.trim())
      .filter((n: string) => ALLERGEN_MAP[n]);

    nums.forEach((n: string) => {
      if (!allergens.find((a) => a.id === n)) {
        allergens.push({ id: n, name: ALLERGEN_MAP[n] });
      }
    });

    if (MEAT_TAGS.some((mt) => innerLower.includes(mt))) {
      return " ";
    }
    return nums.length > 0 ? " " : ` (${inner}) `;
  });

  // Pattern 1b: Allergen numbers jammed mid-string against the following word,
  // e.g. "Stenbitkaker med eggesmør, råkost og 2,4potet" — the canteen types
  // them inline and the widget emits them verbatim. Only strip a run when
  // EVERY number in it is a real allergen id, so quantities survive untouched
  // ("200g biff" leaves "0g" as a candidate, 0 is not an allergen, so it stays).
  dish = dish.replace(/(\d{1,2}(?:,\d{1,2})*)(?=[A-Za-zÆØÅæøå])/g, (match, run: string) => {
    const nums = run.split(",").map((n) => n.trim());
    if (!nums.every((n) => ALLERGEN_MAP[n])) return match;

    nums.forEach((n) => {
      if (!allergens.find((a) => a.id === n)) {
        allergens.push({ id: n, name: ALLERGEN_MAP[n] });
      }
    });
    return " ";
  });

  // Pattern 2: Trailing bare allergen numbers (e.g. "Betasuppe med røkt pølse7" or "Karbonader 1,3,4")
  const spaceRegex = /[\s,]*([\d,\s]+)$/;
  let found = true;
  while (found) {
    const match = dish.match(spaceRegex);
    if (match) {
      const nums = match[1]
        .split(/[,\s]+/)
        .map((n) => n.trim())
        .filter((n) => ALLERGEN_MAP[n]);

      if (nums.length > 0) {
        nums.forEach((n) => {
          if (!allergens.find((a) => a.id === n)) {
            allergens.push({ id: n, name: ALLERGEN_MAP[n] });
          }
        });
        dish = dish.replace(spaceRegex, "").trim();
      } else {
        found = false;
      }
    } else {
      found = false;
    }
  }

  dish = dish.replace(/\s+/g, " ").trim();
  return { dish, isMain: false, allergens };
}

function shouldMerge(line1: string, line2: string): boolean {
  const PREPOSITIONS = [
    "med",
    "og",
    "with",
    "and",
    "in",
    "på",
    "i",
    "over",
    "under",
    "til",
    "fra",
    "av",
    "uten",
    "mashed",
    "served",
    "serveres",
  ];

  const trimmed1 = line1.trim();
  const trimmed2 = line2.trim();

  const words1 = trimmed1.split(/\s+/);
  const lastWord1 = words1[words1.length - 1]
    .toLowerCase()
    .replace(/[^\wæøåáéíóú]/gi, "");

  if (PREPOSITIONS.includes(lastWord1)) return true;

  const firstChar2 = trimmed2.charAt(0);
  if (
    firstChar2 === firstChar2.toLowerCase() &&
    firstChar2 !== firstChar2.toUpperCase() &&
    trimmed2.length < 35
  ) {
    return true;
  }

  return false;
}

export function mergeItems(rawItems: string[]): string[] {
  return rawItems
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .reduce((merged: string[], line: string) => {
      const lastIdx = merged.length - 1;
      if (lastIdx >= 0 && shouldMerge(merged[lastIdx], line)) {
        merged[lastIdx] = `${merged[lastIdx]} ${line}`;
      } else {
        merged.push(line);
      }
      return merged;
    }, []);
}

async function fetchWithRetry(url: string, retries = 2, timeoutMs = 8000): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      clearTimeout(timer);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw new Error("Failed after retries");
}

export async function scrapeSingleCanteen(
  canteen: CanteenConfig
): Promise<CanteenData> {
  const url = `https://widget.inisign.com/Widget/Customers/Customer.aspx?token=${canteen.token}&scaleToFit=true`;
  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const week = $("h2").first().text().trim() || "Unknown";

  const sections: { header: string; items: string[] }[] = [];
  let currentHeader: string | null = null;
  let currentItems: string[] = [];

  $("h1, .menu-container > div, .menu-container").each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    if (el.tagName.toUpperCase() === "H1") {
      if (currentHeader) {
        sections.push({ header: currentHeader, items: [...new Set(currentItems)] });
      }
      currentHeader = text.toUpperCase();
      currentItems = [];
    } else {
      // If this element has child divs, skip the parent container itself to prevent jammed duplicate text
      if ($(el).children("div").length > 0) return;

      const parent = $(el).parent();
      const siblings = parent.children("div");
      if (siblings.length > 1 && $(siblings[0]).get(0) === el) {
        const restText = siblings
          .slice(1)
          .map((_, s) => $(s).text().trim())
          .get()
          .join("");
        if (text.replace(/\s+/g, "") === restText.replace(/\s+/g, "")) {
          return;
        }
      }

      const splitLines = text
        .split("\n")
        .map((i) => i.trim())
        .filter((i) => i.length > 1);

      for (const line of splitLines) {
        const jammed = splitJammedDishes(line);
        currentItems.push(...jammed);
      }
    }
  });

  if (currentHeader) {
    sections.push({ header: currentHeader, items: [...new Set(currentItems)] });
  }

  const groupedMenu: Record<string, any> = {};

  sections.forEach((sec) => {
    const dayKey = DAY_MAP[sec.header];
    if (!dayKey) return;

    if (!groupedMenu[dayKey]) {
      groupedMenu[dayKey] = {
        day: dayKey.charAt(0).toUpperCase() + dayKey.slice(1),
      };
    }

    const lang = [
      "MANDAG",
      "TIRSDAG",
      "ONSDAG",
      "TORSDAG",
      "FREDAG",
    ].includes(sec.header)
      ? "no"
      : "en";

    const mergedItems = mergeItems(sec.items);
    const availabilityNotes: string[] = [];
    const dishItems: string[] = [];

    for (const item of mergedItems) {
      const note = extractAvailabilityNote(item);
      if (note) {
        if (!availabilityNotes.includes(note)) availabilityNotes.push(note);
        continue;
      }
      if (isLikelyThemeHeader(item)) continue;
      dishItems.push(item);
    }

    const parsed = dishItems
      .map((item) => parseItem(item))
      .filter((it) => it.dish.trim().length > 0);

    // Rank so the true main dish sits at index 0 with isMain set. Shared with
    // the client and the image pipeline so all three pick the same dish.
    const ranked = rankItems(parsed, canteen.displayName);

    groupedMenu[dayKey][lang] = {
      label: sec.header,
      items: ranked,
      ...(availabilityNotes.length ? { availabilityNotes } : {}),
    };
  });

  return {
    week,
    openingHours: canteen.hours,
    menu: Object.values(groupedMenu),
  };
}

export async function scrapeAllCanteens(): Promise<MenuData> {
  const results: Record<string, CanteenData> = {};

  await Promise.all(
    CANTEENS.map(async (canteen) => {
      try {
        const data = await scrapeSingleCanteen(canteen);
        results[canteen.displayName] = data;
      } catch (err) {
        console.error(`Error scraping ${canteen.name}:`, err);
      }
    })
  );

  return {
    scrapedAt: new Date().toISOString(),
    canteens: results,
  };
}
