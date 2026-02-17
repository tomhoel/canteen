const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// ─── Config ───
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

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

    // Pattern 1: Numbers in parentheses like "(1,3,4)"
    const parenRegex = /\s*\(([^)]*\d[^)]*)\)\s*$/;
    const parenMatch = dish.match(parenRegex);
    if (parenMatch) {
        const nums = parenMatch[1].split(/[,\s]+/).map(n => n.trim()).filter(n => ALLERGEN_MAP[n]);
        nums.forEach(n => {
            if (!allergens.find(a => a.id === n)) allergens.push({ id: n, name: ALLERGEN_MAP[n] });
        });
        dish = dish.replace(parenRegex, '').trim();
    }

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

// ─── Merge continuation lines ───
// e.g. "Fullkorn pasta Bolognese med" + "parmesan 1,3,4" → "Fullkorn pasta Bolognese med parmesan 1,3,4"
function mergeItems(rawItems) {
    const merged = [];
    for (let i = 0; i < rawItems.length; i++) {
        const line = rawItems[i].trim();
        if (!line) continue;

        // If the previous line ends with a preposition/conjunction, merge this line into it
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            const endsWithPrep = /\b(med|og|with|and|in|på|i|over|under|til|fra|av|uten|mashed)\s*$/i.test(prev);
            const startsLowercase = /^[a-zæøå]/.test(line);
            if (endsWithPrep || (startsLowercase && line.length < 30)) {
                merged[merged.length - 1] = prev + ' ' + line;
                continue;
            }
        }
        merged.push(line);
    }
    return merged;
}

// ─── Scrape a single canteen ───
async function scrapeCanteen(url) {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForSelector('.menu-container', { timeout: 10000 }).catch(() => { });

    const rawData = await page.evaluate(() => {
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

    await browser.close();

    // Group by language and day
    const groupedMenu = {};
    rawData.sections.forEach(sec => {
        const dayKey = DAY_MAP[sec.header];
        if (!dayKey) return;

        if (!groupedMenu[dayKey]) groupedMenu[dayKey] = { day: dayKey.charAt(0).toUpperCase() + dayKey.slice(1) };

        const lang = (sec.header === 'MANDAG' || sec.header === 'TIRSDAG' || sec.header === 'ONSDAG' || sec.header === 'TORSDAG' || sec.header === 'FREDAG') ? 'no' : 'en';

        // Merge continuation lines before parsing
        const mergedItems = mergeItems(sec.items);
        groupedMenu[dayKey][lang] = {
            label: sec.header,
            items: mergedItems.map((item, idx) => parseItem(item, idx === 0))
        };
    });

    return { week: rawData.week, menu: Object.values(groupedMenu) };
}

// ─── Generate food image with Gemini ───
async function generateFoodImage(dishName, canteenName, dayName) {
    const prompt = `Professional food photography of "${dishName}", top-down shot on a clean white ceramic plate, soft natural lighting, shallow depth of field, restaurant quality presentation, minimalist Scandinavian style, no text or labels, photorealistic`;

    console.log(`  📸 Generating image for: ${dishName}...`);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: prompt,
            config: {
                responseModalities: ['Text', 'Image'],
            },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const buffer = Buffer.from(part.inlineData.data, 'base64');
                return buffer;
            }
        }
        console.log(`  ⚠️ No image returned for ${dishName}`);
        return null;
    } catch (error) {
        console.error(`  ❌ Image generation failed for ${dishName}:`, error.message);
        return null;
    }
}

// ─── Main ───
async function main() {
    const today = new Date();
    const jsDay = today.getDay(); // 0=Sun, 6=Sat
    const todayIndex = (jsDay === 0 || jsDay === 6) ? -1 : jsDay - 1;
    const todayKey = todayIndex >= 0 ? DAY_ORDER[todayIndex] : null;

    console.log(`📅 Today is ${todayKey || 'weekend'} (index: ${todayIndex})`);

    // Ensure images directory exists
    const imagesDir = path.join(__dirname, 'public', 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    // Scrape all canteens
    const allResults = { scrapedAt: new Date().toISOString(), canteens: {} };
    for (const canteen of CANTEENS) {
        console.log(`🍽️ Scraping ${canteen.name}...`);
        try {
            const result = await scrapeCanteen(`https://widget.inisign.com/Widget/Customers/Customer.aspx?token=${canteen.token}&scaleToFit=true`);
            allResults.canteens[canteen.displayName] = { week: result.week, openingHours: canteen.hours, menu: result.menu };
        } catch (error) { console.error(`Error ${canteen.name}:`, error); }
    }

    // Generate images for today's main dishes (only on weekdays)
    if (todayKey) {
        console.log(`\n🎨 Generating images for ${todayKey}...`);
        const dayImagesDir = path.join(imagesDir, todayKey);
        if (!fs.existsSync(dayImagesDir)) fs.mkdirSync(dayImagesDir, { recursive: true });

        for (const canteen of CANTEENS) {
            const canteenData = allResults.canteens[canteen.name];
            if (!canteenData) continue;

            const dayEntry = canteenData.menu.find(d => d.day.toLowerCase() === todayKey);
            if (!dayEntry) continue;

            // Use English dish name for better image generation
            const items = dayEntry.en?.items || dayEntry.no?.items;
            if (!items) continue;

            const mainDish = items.find(i => i.isMain);
            if (!mainDish) continue;

            const filename = canteen.name.toLowerCase().replace(/\s+/g, '_') + '.png'; // Use old name for image files
            const filepath = path.join(dayImagesDir, filename);

            // Skip if image already exists
            if (fs.existsSync(filepath)) {
                console.log(`  ✅ Image already exists: ${filepath}`);
                continue;
            }

            const imageBuffer = await generateFoodImage(mainDish.dish, canteen.name, todayKey);
            if (imageBuffer) {
                fs.writeFileSync(filepath, imageBuffer);
                console.log(`  ✅ Saved: ${filepath}`);
            }
        }
    } else {
        console.log('\n📸 Weekend — skipping image generation');
    }

    // Save menu data
    const outputPath = path.join(__dirname, 'public', 'menu.json');
    fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
    console.log('\n✅ Scraping complete! Data saved.');
}

if (require.main === module) {
    main();
}

module.exports = { mergeItems };
