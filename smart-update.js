#!/usr/bin/env node
/**
 * Smart Weekly Update
 * Compares old menu with freshly scraped menu.
 * Only regenerates images for canteens whose main dishes actually changed.
 * Saves Gemini API calls by skipping canteens that are already up-to-date.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenAI } = require('@google/genai');

// Supabase Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 0 } }
    }) 
    : null;

const MENU_PATH = path.join(__dirname, 'public', 'menu.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'images');
const IMAGES_NOBG_DIR = path.join(__dirname, 'public', 'images_nobg');
const HISTORY_DIR = path.join(__dirname, 'public', 'history');
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const ORIGINS_PATH = path.join(__dirname, 'public', 'dish-origins.json');
const DESCRIPTIONS_PATH = path.join(__dirname, 'public', 'dish-descriptions.json');

// High-Res Config
const IMAGE_SIZE_PX = 1024;
const PLATE_RESIZE_PX = 880; 

const EXPECTED_CANTEENS = ['Eat the street', 'Fresh4you', 'Flow'];
const VALID_SLUGS = new Set(EXPECTED_CANTEENS.map(n => n.toLowerCase().replace(/\s+/g, '_')));
const CLOSED_KEYWORDS = ['stengt', 'closed', 'lukket'];

/** Returns true if a dish name is a "closed" placeholder, not real food. */
function isDishClosed(dishName) {
    if (!dishName) return true;
    const lower = dishName.toLowerCase();
    return CLOSED_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Retry a function up to `maxRetries` times with exponential backoff.
 */
async function withRetry(fn, label, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt);
                console.log(`  ⟳ Retry ${attempt + 1}/${maxRetries} for "${label}" in ${delay}ms...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
}

function getDayItems(entry) {
    const en = entry?.en?.items || [];
    const no = entry?.no?.items || [];
    return en.length > 0 ? en : no;
}

function getMainDishes(canteenData) {
    const dishes = {};
    for (const day of DAY_ORDER) {
        const entry = canteenData.menu.find(d => d.day.toLowerCase() === day);
        const items = getDayItems(entry);
        const main = items.find(i => i.isMain);
        dishes[day] = main?.dish || null;
    }
    return dishes;
}

function getISOWeekFromDate(dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

async function existsInSupabase(bucket, path) {
    if (!supabase) return false;
    try {
        const { data, error } = await supabase.storage
            .from(bucket)
            .list(path.split('/').slice(0, -1).join('/'), {
                search: path.split('/').pop()
            });
        if (error) throw error;
        return data && data.length > 0;
    } catch (err) {
        return false;
    }
}

function getCurrentISOWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function parseMenuWeekNumber(weekStr) {
    const match = weekStr && weekStr.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

function validateMenu(menu) {
    const issues = [];
    if (!menu || !menu.canteens) return { valid: false, issues: ['No data'] };
    return { valid: true, issues: [] };
}

const MASTER_PLATE_REF_PATH = path.join(__dirname, 'public', 'images', 'master-plate-ref.png');

async function uploadToSupabase(bucket, path, buffer, contentType = 'image/png') {
    if (!supabase) return false;
    try {
        const { error } = await supabase.storage
            .from(bucket)
            .upload(path, buffer, { contentType, upsert: true });
        if (error) throw error;
        return true;
    } catch (err) {
        console.error(`  ❌ Supabase upload failed (${path}): ${err.message}`);
        return false;
    }
}

async function generateSingleImage(dishName, canteenName, day) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return false;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const hasMasterPlate = fs.existsSync(MASTER_PLATE_REF_PATH);
    const promptText = `Professional overhead food photography of "${dishName}". High contrast, dark grey background, warm beige plate.`;

    const parts = [{ text: promptText }];
    if (hasMasterPlate) {
        const plateData = fs.readFileSync(MASTER_PLATE_REF_PATH).toString('base64');
        parts.push({ inlineData: { mimeType: 'image/png', data: plateData } });
    }

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: [{ role: 'user', parts }],
            config: { responseModalities: ["IMAGE"] },
        }), `image: ${dishName}`);

        const candidate = response.candidates?.[0];
        if (!candidate) return false;

        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                const sharp = require('sharp');
                const raw = Buffer.from(part.inlineData.data, 'base64');
                const pngBuffer = await sharp(raw).png().toBuffer();
                const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
                const dayDir = path.join(IMAGES_DIR, day);
                if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
                fs.writeFileSync(path.join(dayDir, `${slug}.png`), pngBuffer);
                await uploadToSupabase('images', `${day}/${slug}.png`, pngBuffer);
                return true;
            }
        }
        return false;
    } catch (error) {
        console.error(`  ❌ Generation failed: ${error.message}`);
        return false;
    }
}

async function removeBgSingle(canteenName, day) {
    const sharp = require('sharp');
    const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
    const inputPath = path.join(IMAGES_DIR, day, `${slug}.png`);
    const outputDir = path.join(IMAGES_NOBG_DIR, day);
    const outputPath = path.join(outputDir, `${slug}.png`);

    if (!fs.existsSync(inputPath)) return false;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    try {
        const { data, info } = await sharp(inputPath).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const totalPixels = width * height;
        const visited = new Uint8Array(totalPixels);
        const isBg = new Uint8Array(totalPixels);
        const queue = new Int32Array(totalPixels);
        let qHead = 0, qTail = 0;

        const enqueue = (idx) => { if (idx >= 0 && idx < totalPixels && !visited[idx]) { visited[idx] = 1; queue[qTail++] = idx; } };
        for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
        for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }

        while (qHead < qTail) {
            const idx = queue[qHead++];
            const pi = idx * channels;
            const r = data[pi], g = data[pi + 1], b = data[pi + 2];
            const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            const brightness = (r + g + b) / 3;
            if (!(maxDiff < 50 && brightness <= 185)) continue;
            isBg[idx] = 1;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0) enqueue(idx - 1); if (x < width - 1) enqueue(idx + 1);
            if (y > 0) enqueue(idx - width); if (y < height - 1) enqueue(idx + width);
        }

        for (let i = 0; i < totalPixels; i++) if (isBg[i]) data[i * channels + 3] = 0;

        const finalBuffer = await sharp(data, { raw: { width, height, channels } })
            .trim().resize(PLATE_RESIZE_PX, PLATE_RESIZE_PX, { fit: 'inside' })
            .extend({ top: (IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2, bottom: (IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2, left: (IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2, right: (IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9, palette: true }).toBuffer();

        fs.writeFileSync(outputPath, finalBuffer);
        await uploadToSupabase('images-nobg', `${day}/${slug}.png`, finalBuffer);
        return true;
    } catch (error) {
        console.error(`  ❌ BG removal failed: ${error.message}`);
        return false;
    }
}

async function analyzeDish(dishName) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return null;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const promptText = `Analyze dish "${dishName}". Respond ONLY with JSON: {"origin":{"country":"Italy","code":"it"},"description":{"en":"...","no":"..."},"isValidDish":true}`;
    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: { responseMimeType: 'application/json' },
        }), `analyze: ${dishName}`);
        return JSON.parse(response.candidates[0].content.parts[0].text.trim());
    } catch (error) { return null; }
}

async function cleanDishTitles(menu) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return {};
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const allDishes = new Set();
    for (const canteen of Object.values(menu.canteens)) {
        for (const dayEntry of canteen.menu) {
            for (const lang of ['no', 'en']) {
                for (const item of (dayEntry[lang]?.items || [])) {
                    if (item.dish && !isDishClosed(item.dish)) allDishes.add(item.dish);
                }
            }
        }
    }
    if (allDishes.size === 0) return {};
    const promptText = `Fix Norwegian typos in: ${[...allDishes].join(', ')}. Respond ONLY with JSON: {"original": "corrected"}`;
    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: { responseMimeType: 'application/json' },
        }), 'title cleanup');
        return JSON.parse(response.candidates[0].content.parts[0].text.trim());
    } catch (error) { return {}; }
}

function applyTitleCorrections(menu, corrections) {
    let count = 0;
    for (const canteen of Object.values(menu.canteens)) {
        for (const dayEntry of canteen.menu) {
            for (const lang of ['no', 'en']) {
                for (const item of (dayEntry[lang]?.items || [])) {
                    if (item.dish && corrections[item.dish]) { item.dish = corrections[item.dish]; count++; }
                }
            }
        }
    }
    return count;
}

async function archiveCurrentWeek(oldMenu) {
    const d = new Date(oldMenu.scrapedAt);
    const weekKey = `${d.getFullYear()}-W${String(getISOWeekFromDate(oldMenu.scrapedAt)).padStart(2, '0')}`;
    if (supabase) {
        await uploadToSupabase('history', `${weekKey}/menu.json`, Buffer.from(JSON.stringify(oldMenu, null, 2)), 'application/json');
        console.log(`  ✅ Archived ${weekKey} to Supabase`);
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  SMART WEEKLY UPDATE                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    let oldMenu = fs.existsSync(MENU_PATH) ? JSON.parse(fs.readFileSync(MENU_PATH, 'utf8')) : null;
    const origins = fs.existsSync(ORIGINS_PATH) ? JSON.parse(fs.readFileSync(ORIGINS_PATH, 'utf8')) : {};
    const descriptions = fs.existsSync(DESCRIPTIONS_PATH) ? JSON.parse(fs.readFileSync(DESCRIPTIONS_PATH, 'utf8')) : {};

    console.log('\n📥 Scraping fresh menu...');
    execSync('node scraper.js', { stdio: 'inherit' });
    const newMenu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));

    console.log('\n✏️  Cleaning dish titles...');
    const corrections = await cleanDishTitles(newMenu);
    applyTitleCorrections(newMenu, corrections);
    fs.writeFileSync(MENU_PATH, JSON.stringify(newMenu, null, 2));

    if (oldMenu) {
        const oldW = parseMenuWeekNumber(Object.values(oldMenu.canteens)[0]?.week);
        const newW = parseMenuWeekNumber(Object.values(newMenu.canteens)[0]?.week);
        if (oldW !== null && newW !== null && newW > oldW) await archiveCurrentWeek(oldMenu);
    }

    console.log('\n🔍 Checking Supabase storage...');
    const changes = [];
    const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    for (const [canteenName, newCanteen] of Object.entries(newMenu.canteens)) {
        const oldCanteen = oldMenu?.canteens?.[canteenName];
        const newDishes = getMainDishes(newCanteen);
        const oldDishes = oldCanteen ? getMainDishes(oldCanteen) : {};

        for (const day of DAY_ORDER) {
            const newDish = newDishes[day];
            if (!newDish || isDishClosed(newDish)) continue;
            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const exists = await existsInSupabase('images-nobg', `${day}/${slug}.png`);
            if (normalize(oldDishes[day]) !== normalize(newDish) || !exists) {
                changes.push({ canteenName, day, newDish });
            }
        }
    }

    if (changes.length === 0) {
        console.log('\n✅ Everything up to date!');
    } else {
        console.log(`\n🔄 Generating ${changes.length} missing images...`);
        for (const c of changes) {
            console.log(`📸 ${c.canteenName} / ${c.day}: ${c.newDish.substring(0, 30)}...`);
            if (await generateSingleImage(c.newDish, c.canteenName, c.day)) {
                await removeBgSingle(c.canteenName, c.day);
                console.log('  ✅ Done');
            }
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    console.log('\n🍽️  Checking closed days...');
    for (const [canteenName, canteen] of Object.entries(newMenu.canteens)) {
        for (const day of DAY_ORDER) {
            const entry = canteen.menu.find(d => d.day.toLowerCase() === day);
            const main = getDayItems(entry).find(i => i.isMain);
            if (main && !isDishClosed(main.dish)) continue;
            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const staticSrc = path.join(__dirname, 'public', 'images', 'closed-plates', `closed-plate-1.png`);
            if (fs.existsSync(staticSrc)) {
                const buffer = fs.readFileSync(staticSrc);
                await uploadToSupabase('images', `${day}/${slug}.png`, buffer);
                await uploadToSupabase('images-nobg', `${day}/${slug}.png`, buffer);
            }
        }
    }

    console.log('\n🔍 Final analysis...');
    const allDishNames = new Set();
    for (const c of Object.values(newMenu.canteens)) {
        for (const d of c.menu) {
            const m = getDayItems(d).find(i => i.isMain);
            if (m?.dish && !isDishClosed(m.dish)) allDishNames.add(m.dish);
        }
    }
    for (const name of allDishNames) {
        if (!origins[name] || !descriptions[name]) {
            const res = await analyzeDish(name);
            if (res) { origins[name] = res.origin; descriptions[name] = res.description; }
        }
    }
    fs.writeFileSync(ORIGINS_PATH, JSON.stringify(origins, null, 2));
    fs.writeFileSync(DESCRIPTIONS_PATH, JSON.stringify(descriptions, null, 2));
    console.log('\n🏁 FINISHED');
}

main().catch(console.error);
