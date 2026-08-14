import * as cheerio from "cheerio";
import type { MenuData, CanteenData, MenuItem, Allergen, DayMenu } from "../../lib/types.ts";
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

/**
 * Day headings, mapped to a weekday plus the language they were written in.
 * The widget emits one section per day per language, and the heading text is
 * the only signal for which is which — deriving it by asking "is this heading
 * in the Norwegian list" left English-only days silently mislabelled.
 */
const DAY_HEADINGS: Record<string, { day: string; lang: "no" | "en" }> = {
  MANDAG: { day: "monday", lang: "no" },
  MONDAY: { day: "monday", lang: "en" },
  TIRSDAG: { day: "tuesday", lang: "no" },
  TUESDAY: { day: "tuesday", lang: "en" },
  THUESDAY: { day: "tuesday", lang: "en" }, // the widget's own typo
  ONSDAG: { day: "wednesday", lang: "no" },
  WEDNESDAY: { day: "wednesday", lang: "en" },
  TORSDAG: { day: "thursday", lang: "no" },
  THURSDAY: { day: "thursday", lang: "en" },
  FREDAG: { day: "friday", lang: "no" },
  FRIDAY: { day: "friday", lang: "en" },
};

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday"];

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

/**
 * Splits lines where the kitchen ran two dishes together, e.g. an allergen
 * group immediately followed by the next capitalised dish name.
 */
export function splitJammedDishes(text: string): string[] {
  const regex = /(?<=\(\d+(?:[,\s]+\d+)*\)|[\d,]{1,5})(?=[A-ZÆØÅ])/;
  return text
    .split(regex)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

export function parseItem(text: string): MenuItem {
  let dish = text;
  const allergens: Allergen[] = [];

  const addAllergen = (id: string) => {
    if (!allergens.find((a) => a.id === id)) {
      allergens.push({ id, name: ALLERGEN_MAP[id] });
    }
  };

  // Parenthetical groups — pull out allergen numbers, drop meat tags, keep
  // anything else (dietary notes are extracted separately, before this).
  dish = dish.replace(/\s*\(([^)]+)\)\s*/g, (_match, inner) => {
    const innerLower = inner.toLowerCase().trim();
    const nums: string[] = inner
      .trim()
      .split(/[,\s]+/)
      .map((n: string) => n.trim())
      .filter((n: string) => ALLERGEN_MAP[n]);

    nums.forEach(addAllergen);

    if (MEAT_TAGS.some((mt) => innerLower.includes(mt))) return " ";
    return nums.length > 0 ? " " : ` (${inner}) `;
  });

  // Allergen numbers jammed mid-string against the following word, e.g.
  // "Stenbitkaker med eggesmør, råkost og 2,4potet" — the canteen types them
  // inline and the widget emits them verbatim. Only strip a run when EVERY
  // number in it is a real allergen id, so quantities survive untouched
  // ("200g biff" leaves "0g" as a candidate, 0 is not an allergen, so it stays).
  dish = dish.replace(/(\d{1,2}(?:,\d{1,2})*)(?=[A-Za-zÆØÅæøå])/g, (match, run: string) => {
    const nums = run.split(",").map((n) => n.trim());
    if (!nums.every((n) => ALLERGEN_MAP[n])) return match;
    nums.forEach(addAllergen);
    return " ";
  });

  // Trailing bare allergen numbers ("Karbonader 1,3,4", "…pølse7").
  const trailing = /[\s,]*([\d,\s]+)$/;
  for (;;) {
    const match = dish.match(trailing);
    if (!match) break;

    const nums = match[1]
      .split(/[,\s]+/)
      .map((n) => n.trim())
      .filter((n) => ALLERGEN_MAP[n]);

    if (nums.length === 0) break;
    nums.forEach(addAllergen);
    dish = dish.replace(trailing, "").trim();
  }

  return { dish: dish.replace(/\s+/g, " ").trim(), isMain: false, allergens };
}

function shouldMerge(line1: string, line2: string): boolean {
  const PREPOSITIONS = [
    "med", "og", "with", "and", "in", "på", "i", "over", "under",
    "til", "fra", "av", "uten", "mashed", "served", "serveres",
  ];

  const trimmed1 = line1.trim();
  const trimmed2 = line2.trim();

  const words1 = trimmed1.split(/\s+/);
  const lastWord1 = words1[words1.length - 1].toLowerCase().replace(/[^\wæøåáéíóú]/gi, "");
  if (PREPOSITIONS.includes(lastWord1)) return true;

  // A short continuation line that starts lowercase belongs to the line above.
  const firstChar2 = trimmed2.charAt(0);
  return (
    firstChar2 === firstChar2.toLowerCase() &&
    firstChar2 !== firstChar2.toUpperCase() &&
    trimmed2.length < 35
  );
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

async function fetchWithRetry(url: string, retries = 2, timeoutMs = 10000): Promise<string> {
  let lastError: unknown;

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

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    `Failed after ${retries + 1} attempts: ${(lastError as Error)?.message ?? lastError}`
  );
}

/** One `<h1>` heading and the lines that followed it. */
interface RawSection {
  heading: string;
  lines: string[];
}

/**
 * Walks the widget markup and groups text lines under their day heading.
 *
 * The markup nests menu text in containers that also repeat their children's
 * text, so a naive walk double-counts every dish. Two guards handle it: skip
 * any element that has child divs (its text is the concatenation of theirs),
 * and skip a first child whose text equals the joined text of its siblings.
 */
function extractSections($: cheerio.CheerioAPI): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | null = null;

  $("h1, .menu-container > div, .menu-container").each((_, el) => {
    const text = $(el).text().trim();
    if (!text) return;

    if (el.tagName.toUpperCase() === "H1") {
      // A heading we recognise starts a new day section.
      if (DAY_HEADINGS[text.toUpperCase()]) {
        if (current) sections.push(current);
        current = { heading: text.toUpperCase(), lines: [] };
        return;
      }

      // Flow's widget sometimes emits a day's dishes *inside* an <h1> rather
      // than in the content divs — e.g. an h1 reading "Lentil curry with
      // coconut milk (7)Root vegetable soup (7)…" right after the "Tuesday"
      // heading. Treating that as an unknown heading threw the whole day
      // away, which is why Flow showed no English menu on those days. Fold
      // it into the current section instead; genuine short theme headers are
      // filtered out later by isLikelyThemeHeader.
      if (current) {
        for (const line of text.split("\n").map((l) => l.trim()).filter((l) => l.length > 1)) {
          current.lines.push(...splitJammedDishes(line));
        }
      }
      return;
    }

    if (!current) return;
    if ($(el).children("div").length > 0) return;

    const parent = $(el).parent();
    const siblings = parent.children("div");
    if (siblings.length > 1 && $(siblings[0]).get(0) === el) {
      const restText = siblings
        .slice(1)
        .map((_i, s) => $(s).text().trim())
        .get()
        .join("");
      if (text.replace(/\s+/g, "") === restText.replace(/\s+/g, "")) return;
    }

    for (const line of text.split("\n").map((l) => l.trim()).filter((l) => l.length > 1)) {
      current.lines.push(...splitJammedDishes(line));
    }
  });

  if (current) sections.push(current);
  return sections;
}

interface ParsedSection {
  items: MenuItem[];
  availabilityNotes: string[];
}

/** Turns one section's raw lines into ranked menu items plus dietary notes. */
function parseSection(lines: string[], canteenDisplayName: string): ParsedSection {
  const availabilityNotes: string[] = [];
  const dishLines: string[] = [];

  for (const line of mergeItems([...new Set(lines)])) {
    const note = extractAvailabilityNote(line);
    if (note) {
      if (!availabilityNotes.includes(note)) availabilityNotes.push(note);
      continue;
    }
    if (isLikelyThemeHeader(line)) continue;
    dishLines.push(line);
  }

  const parsed = dishLines
    .map((line) => parseItem(line))
    .filter((item) => item.dish.trim().length > 0);

  return { items: rankItems(parsed, canteenDisplayName), availabilityNotes };
}

export interface CanteenScrapeResult {
  canteen: CanteenConfig;
  data: CanteenData | null;
  /** Non-fatal observations worth logging (missing days, one-language days). */
  warnings: string[];
  /** Set when the canteen could not be scraped at all. */
  error: string | null;
}

/**
 * Turns widget HTML into a week of menus. Separated from fetching so the
 * parsing can be tested against fixtures without touching the network.
 */
export function parseCanteenHtml(html: string, canteen: CanteenConfig): CanteenData {
  const $ = cheerio.load(html);

  const week = $("h2").first().text().trim() || "Unknown";
  const byDay = new Map<string, { day: string; no?: DayMenu; en?: DayMenu }>();

  for (const section of extractSections($)) {
    const heading = DAY_HEADINGS[section.heading];
    if (!heading) continue;

    const { items, availabilityNotes } = parseSection(section.lines, canteen.displayName);
    if (items.length === 0) continue;

    const entry = byDay.get(heading.day) ?? {
      day: heading.day.charAt(0).toUpperCase() + heading.day.slice(1),
    };
    entry[heading.lang] = {
      label: section.heading,
      items,
      ...(availabilityNotes.length ? { availabilityNotes } : {}),
    };
    byDay.set(heading.day, entry);
  }

  // Keep Monday-to-Friday order regardless of the order the widget emitted.
  const menu = DAY_ORDER.map((d) => byDay.get(d)).filter(Boolean) as CanteenData["menu"];

  return { week, openingHours: canteen.hours, menu };
}

export async function scrapeSingleCanteen(canteen: CanteenConfig): Promise<CanteenData> {
  const url = `https://widget.inisign.com/Widget/Customers/Customer.aspx?token=${canteen.token}&scaleToFit=true`;
  const html = await fetchWithRetry(url);
  return parseCanteenHtml(html, canteen);
}

/** Flags days that came back in only one language, or a short week. */
function inspect(data: CanteenData): string[] {
  const warnings: string[] = [];

  if (data.menu.length < DAY_ORDER.length) {
    const present = new Set(data.menu.map((d) => d.day.toLowerCase()));
    const missing = DAY_ORDER.filter((d) => !present.has(d));
    warnings.push(`no menu for ${missing.join(", ")}`);
  }

  for (const day of data.menu) {
    const no = day.no?.items?.length ?? 0;
    const en = day.en?.items?.length ?? 0;
    if (no === 0) warnings.push(`${day.day}: no Norwegian items`);
    else if (en === 0) warnings.push(`${day.day}: no English items`);
  }

  if (!/\d/.test(data.week)) {
    warnings.push(`week label has no number: "${data.week}"`);
  }

  return warnings;
}

export interface ScrapeReport {
  menuData: MenuData;
  results: CanteenScrapeResult[];
  /** Canteens that produced no usable data at all. */
  failed: string[];
}

/**
 * Scrapes every canteen, keeping going when one fails.
 *
 * The previous version swallowed per-canteen errors and simply left that
 * canteen out of the result, so an outage was indistinguishable from a
 * canteen that had genuinely published nothing. Failures are now reported so
 * the caller can decide whether the run is still worth persisting.
 */
export async function scrapeAllCanteens(): Promise<ScrapeReport> {
  const results = await Promise.all(
    CANTEENS.map(async (canteen): Promise<CanteenScrapeResult> => {
      try {
        const data = await scrapeSingleCanteen(canteen);
        if (data.menu.length === 0) {
          return { canteen, data: null, warnings: [], error: "no menu sections found" };
        }
        return { canteen, data, warnings: inspect(data), error: null };
      } catch (err: any) {
        return { canteen, data: null, warnings: [], error: err?.message ?? String(err) };
      }
    })
  );

  const canteens: Record<string, CanteenData> = {};
  for (const r of results) {
    if (r.data) canteens[r.canteen.displayName] = r.data;
    for (const w of r.warnings) {
      console.warn(`⚠️  ${r.canteen.displayName}: ${w}`);
    }
    if (r.error) {
      console.error(`❌ ${r.canteen.displayName}: ${r.error}`);
    }
  }

  return {
    menuData: { scrapedAt: new Date().toISOString(), canteens },
    results,
    failed: results.filter((r) => !r.data).map((r) => r.canteen.displayName),
  };
}
