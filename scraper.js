const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CANTEENS = [
    { name: 'The Hub', token: '6e5cc038-e918-4f97-9a59-d2afa0456abf', hours: '11:00 - 13:30', displayName: 'Eat the street' },
    { name: 'Telenor Expo', token: 'a8923cdb-9d92-46bc-b6a4-d026c2cf9a89', hours: '11:00 - 13:30', displayName: 'Fresh4you' },
    { name: 'Bygg B', token: '756a5aa2-a95f-4d15-ad5a-59829741075b', hours: '11:00 - 13:00', displayName: 'Flow' }
];

const DAY_MAP = {
    'MANDAG': 'monday', 'MONDAY': 'monday',
    'TIRSDAG': 'tuesday', 'TUESDAY': 'tuesday', 'THUESDAY': 'tuesday',
    'ONSDAG': 'wednesday', 'WEDNESDAY': 'wednesday',
    'TORSDAG': 'thursday', 'THURSDAY': 'thursday',
    'FREDAG': 'friday', 'FRIDAY': 'friday'
};

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

const ALLERGEN_MAP = {
    "1": "Egg", "2": "Fish", "3": "Gluten", "4": "Milk", "5": "Nuts",
    "6": "Peanuts", "7": "Celery", "8": "Mustard", "9": "Sesame seeds",
    "10": "Shellfish", "11": "Soya", "12": "Sulphites", "13": "Molluscs", "14": "Lupin"
};

// ─── Parse dish text: extract allergens, clean name ───
function parseItem(text, isMain = false) {
    let dish = text;
    let allergens = [];

    // Pattern 1: All parenthetical groups — extract allergen numbers, strip everything else
    // Handles "(1,3,4) (Svin)", "(Biff)", "(3)", mid-string allergens, etc.
    dish = dish.replace(/\s*\(([^)]+)\)\s*/g, (_match, inner) => {
        const nums = inner.trim().split(/[,\s]+/).map(n => n.trim()).filter(n => ALLERGEN_MAP[n]);
        nums.forEach(n => {
            if (!allergens.find(a => a.id === n)) allergens.push({ id: n, name: ALLERGEN_MAP[n] });
        });
        return ' ';
    });

    // Pattern 2: Trailing numbers with space separator
    const spaceRegex = /[\s,]+([\d,\s]+)$/;
    let found = true;
    while (found) {
        const match = dish.match(spaceRegex);
        if (match) {
            const nums = match[1].split(/[,\s]+/).map(n => n.trim()).filter(n => ALLERGEN_MAP[n]);
            if (nums.length > 0) {
                nums.forEach(n => {
                    if (!allergens.find(a => a.id === n)) allergens.push({ id: n, name: ALLERGEN_MAP[n] });
                });
                dish = dish.replace(spaceRegex, '').trim();
            } else { found = false; }
        } else { found = false; }
    }

    // Pattern 3: Numbers glued to end of word like "potatoes8"
    const gluedRegex = /([a-zA-ZæøåÆØÅ])([\d]+(?:,[\d]+)*)$/;
    const gluedMatch = dish.match(gluedRegex);
    if (gluedMatch) {
        const nums = gluedMatch[2].split(',').map(n => n.trim()).filter(n => ALLERGEN_MAP[n]);
        if (nums.length > 0) {
            nums.forEach(n => {
                if (!allergens.find(a => a.id === n)) allergens.push({ id: n, name: ALLERGEN_MAP[n] });
            });
            dish = dish.replace(gluedRegex, '$1').trim();
        }
    }

    return { dish: dish.replace(/\s+/g, ' ').trim(), allergens, isMain };
}

/**
 * Determines if the current line should be merged into the previous line.
 * Merging happens if the previous line ends with a preposition/conjunction,
 * or if the current line starts with a lowercase letter and is relatively short.
 */
function shouldMerge(prevLine, currentLine) {
    const CONTINUATION_WORDS = /\b(med|og|with|and|in|på|i|over|under|til|fra|av|uten|mashed)\s*$/i;
    const STARTS_WITH_LOWERCASE = /^[a-zæøå]/;
    const MAX_CONTINUATION_LENGTH = 30;

    const endsWithContinuation = CONTINUATION_WORDS.test(prevLine);
    const startsWithLowercase = STARTS_WITH_LOWERCASE.test(currentLine);
    const isShortLine = currentLine.length < MAX_CONTINUATION_LENGTH;

    return endsWithContinuation || (startsWithLowercase && isShortLine);
}

/**
 * Detect theme/category headers that aren't actual dishes.
 * e.g. "MIDDELHAVET", "THE MEDITERRANEAN SEA", "ASIAN STREET FOOD"
 * These are all-caps, short, and have no allergen indicators.
 */
function isLikelyThemeHeader(rawText) {
    const cleaned = rawText.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
    if (!cleaned) return false;
    const isAllCaps = cleaned === cleaned.toUpperCase() && /[A-Z]/.test(cleaned);
    const isShort = cleaned.split(/\s+/).length <= 5;
    const hasNoNumbers = !/\d/.test(rawText);
    return isAllCaps && isShort && hasNoNumbers;
}

/**
 * Standalone-tag lines that aren't dishes — informational notes published
 * by the canteen (e.g. "(Halal tilgjengelig)", "(Glutenfri tilgjengelig)",
 * "(Vegan available)"). They sit on their own line between actual dishes
 * and would otherwise turn into empty MenuItem entries when parseItem
 * strips the parens.
 *
 * Returns the inside text if matched, else null.
 */
function extractAvailabilityNote(rawText) {
    const m = rawText.trim().match(/^\(([^()]+)\)$/);
    if (!m) return null;
    const inside = m[1].trim();
    // Filter: only keep notes that read like a canteen-wide hint, not allergens.
    const looksLikeNote = /\b(tilgjengelig|available|halal|glutenfri|laktosefri|nøttefri|vegan|vegetar|vegetarian)\b/i.test(inside);
    if (!looksLikeNote) return null;
    return inside;
}

// ─── Merge continuation lines ───
// e.g. "Fullkorn pasta Bolognese med" + "parmesan 1,3,4" → "Fullkorn pasta Bolognese med parmesan 1,3,4"
function mergeItems(rawItems) {
    return rawItems
        .map(item => item.trim())
        .filter(item => item.length > 0)
        .reduce((merged, line) => {
            const lastIdx = merged.length - 1;
            if (lastIdx >= 0 && shouldMerge(merged[lastIdx], line)) {
                merged[lastIdx] = `${merged[lastIdx]} ${line}`;
            } else {
                merged.push(line);
            }
            return merged;
        }, []);
}

// ─── Scrape a single canteen ───
async function scrapeCanteen(url) {
    const browser = await chromium.launch();
    let rawData;
    try {
        const page = await browser.newPage();
        // The inisign widget keeps long-lived connections open (polling/analytics),
        // so the 'load' event — page.goto's default waitUntil — never fires within
        // the 30s timeout and goto throws before we ever read the menu, which is
        // already in the server-rendered HTML. Wait for 'domcontentloaded' instead
        // and let the .menu-container selector confirm the content is present.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('.menu-container', { timeout: 15000 });

        rawData = await page.evaluate(() => {
            const elements = Array.from(document.querySelectorAll('h1, .menu-container'));
            let week = document.querySelector('h2')?.innerText.trim() || "Unknown";
            let sections = [];
            let currentHeader = null;
            let currentItems = [];

            elements.forEach(el => {
                const text = el.innerText.trim();
                if (!text) return;
                if (el.tagName === 'H1') {
                    if (currentHeader) sections.push({ header: currentHeader, items: [...new Set(currentItems)] });
                    currentHeader = text.toUpperCase();
                    currentItems = [];
                } else {
                    currentItems.push(...text.split('\n').map(i => i.trim()).filter(i => i.length > 1));
                }
            });
            if (currentHeader) sections.push({ header: currentHeader, items: [...new Set(currentItems)] });
            return { week, sections };
        });
    } finally {
        await browser.close();
    }

    // Group by language and day
    const groupedMenu = {};
    rawData.sections.forEach(sec => {
        const dayKey = DAY_MAP[sec.header];
        if (!dayKey) return;

        if (!groupedMenu[dayKey]) groupedMenu[dayKey] = { day: dayKey.charAt(0).toUpperCase() + dayKey.slice(1) };

        const lang = (sec.header === 'MANDAG' || sec.header === 'TIRSDAG' || sec.header === 'ONSDAG' || sec.header === 'TORSDAG' || sec.header === 'FREDAG') ? 'no' : 'en';

        // Merge continuation lines, then peel off availability notes (e.g.
        // "(Halal tilgjengelig)") and theme headers ("ASIAN STREET FOOD")
        // before treating remaining lines as dishes.
        const mergedItems = mergeItems(sec.items);
        const availabilityNotes = [];
        const dishItems = [];
        for (const item of mergedItems) {
            const note = extractAvailabilityNote(item);
            if (note) {
                if (!availabilityNotes.includes(note)) availabilityNotes.push(note);
                continue;
            }
            if (isLikelyThemeHeader(item)) continue;
            dishItems.push(item);
        }

        // Parse each dish, then drop entries that came out empty (e.g. a
        // parenthetical-only line that didn't match the note regex above).
        // Mark isMain on the first SURVIVING entry — assigning it before the
        // filter would lose the main slot to a discarded empty.
        const parsed = dishItems
            .map(item => parseItem(item, false))
            .filter(it => it.dish.trim().length > 0);
        if (parsed.length > 0) parsed[0].isMain = true;

        groupedMenu[dayKey][lang] = {
            label: sec.header,
            items: parsed,
            ...(availabilityNotes.length ? { availabilityNotes } : {}),
        };
    });

    return { week: rawData.week, menu: Object.values(groupedMenu) };
}

// ─── Main ───
async function main() {
    const today = new Date();
    const jsDay = today.getDay(); // 0=Sun, 6=Sat
    const todayIndex = (jsDay === 0 || jsDay === 6) ? -1 : jsDay - 1;
    const todayKey = todayIndex >= 0 ? DAY_ORDER[todayIndex] : null;

    console.log(`📅 Today is ${todayKey || 'weekend'} (index: ${todayIndex})`);

    // Scrape all canteens in parallel
    const allResults = { scrapedAt: new Date().toISOString(), canteens: {} };
    await Promise.all(CANTEENS.map(async (canteen) => {
        console.log(`🍽️ Scraping ${canteen.name}...`);
        try {
            const result = await scrapeCanteen(`https://widget.inisign.com/Widget/Customers/Customer.aspx?token=${canteen.token}&scaleToFit=true`);
            allResults.canteens[canteen.displayName] = { week: result.week, openingHours: canteen.hours, menu: result.menu };
        } catch (error) { console.error(`Error ${canteen.name}:`, error); }
    }));

    // Save menu data
    const outputPath = path.join(__dirname, 'public', 'menu.json');
    fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
    console.log('\n✅ Scraping complete! Data saved.');
}

if (require.main === module) {
    main();
}

module.exports = { mergeItems, parseItem };
