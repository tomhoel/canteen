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

// Generation Config
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

/**
 * The kitchen language at all canteens is Norwegian; the English version on
 * the menu page is a translation maintained by the canteen and sometimes drifts
 * from what's actually served (e.g. NO says "Svensk kjøttgrateng" while EN says
 * "Braised chicken leg with bell pepper sauce" — totally different dishes).
 *
 * For everything downstream — image generation, origin analysis, cache keying —
 * we treat NO as authoritative and only fall back to EN if NO is empty.
 */
function getDayItems(entry) {
    const no = entry?.no?.items || [];
    const en = entry?.en?.items || [];
    return no.length > 0 ? no : en;
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

/**
 * One bulk listing per day folder is much faster than per-slot existence checks.
 * Returns { day → Set<filename> }.
 */
async function listDayContents(bucket, days) {
    if (!supabase) return Object.fromEntries(days.map(d => [d, new Set()]));
    const entries = await Promise.all(days.map(async (day) => {
        const { data, error } = await supabase.storage.from(bucket).list(day, { limit: 200 });
        if (error) {
            console.error(`  ⚠️  list ${bucket}/${day} failed: ${error.message}`);
            return [day, new Set()];
        }
        return [day, new Set((data || []).map(f => f.name))];
    }));
    return Object.fromEntries(entries);
}

/**
 * ISO 8601 says an ISO week's year is the year of its Thursday. Critical at
 * year boundaries: Dec 29 2025 belongs to 2026-W01 even though the calendar
 * year is 2025.
 */
function getISOWeekYearFromDate(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    return d.getFullYear();
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

/**
 * Normalised dish name → cache key. Same dish across weeks/canteens collapses
 * to one key so we can reuse the archived image instead of regenerating.
 */
function normalizeDishName(name) {
    if (!name) return '';
    return name.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

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

/**
 * Copy `srcPath` → `destPath` within a bucket.
 *
 * Tries Supabase's server-side `copy` first (no bytes over the wire). If that
 * fails for any reason — destination exists, mime-type quirks, etc. — falls
 * back to download+upload, which always works as long as we re-state the
 * content type explicitly.
 */
async function copyInBucket(bucket, srcPath, destPath) {
    if (!supabase) return false;
    if (srcPath === destPath) return true;

    const { error: copyErr } = await supabase.storage.from(bucket).copy(srcPath, destPath);
    if (!copyErr) return true;

    try {
        const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(srcPath);
        if (dlErr) throw dlErr;
        const buf = Buffer.from(await blob.arrayBuffer());
        const { error: upErr } = await supabase.storage
            .from(bucket)
            .upload(destPath, buf, { contentType: 'image/png', upsert: true });
        if (upErr) throw upErr;
        return true;
    } catch (err) {
        console.error(`  ❌ copy ${bucket}/${srcPath} → ${destPath}: copy=${copyErr.message}; fallback=${err.message}`);
        return false;
    }
}

/** Read every row of dish_cache once at startup. */
async function loadDishCache() {
    if (!supabase) return {};
    const { data, error } = await supabase.from('dish_cache').select('*');
    if (error) {
        console.error(`  ⚠️  dish_cache load failed: ${error.message}`);
        return {};
    }
    const map = {};
    for (const row of data || []) map[row.cache_key] = row;
    return map;
}

/** Upsert one cache row. */
async function saveDishCacheEntry(entry) {
    if (!supabase) return;
    const { error } = await supabase.from('dish_cache').upsert(entry, { onConflict: 'cache_key' });
    if (error) console.error(`  ⚠️  dish_cache upsert failed (${entry.cache_key}): ${error.message}`);
}

/**
 * Bounded-concurrency map. Runs `fn(item)` for each item with at most
 * `concurrency` in flight. Preserves error isolation: one rejection
 * doesn't tear down the whole batch.
 */
async function asyncPool(concurrency, items, fn) {
    const results = new Array(items.length);
    const inFlight = new Set();
    let nextIdx = 0;

    const launch = (idx) => {
        const p = Promise.resolve()
            .then(() => fn(items[idx], idx))
            .then((v) => { results[idx] = { ok: true, value: v }; },
                  (e) => { results[idx] = { ok: false, error: e }; })
            .finally(() => inFlight.delete(p));
        inFlight.add(p);
        return p;
    };

    while (nextIdx < items.length || inFlight.size > 0) {
        while (inFlight.size < concurrency && nextIdx < items.length) {
            launch(nextIdx++);
        }
        if (inFlight.size > 0) await Promise.race(inFlight);
    }
    return results;
}

async function generateSingleImage(dishName, canteenName, day) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return false;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const hasMasterPlate = fs.existsSync(MASTER_PLATE_REF_PATH);

    // Prompt is co-designed with removeBgSingle's flood-fill: the algorithm
    // accepts a pixel as background only if `maxDiff < 50 && brightness <= 185`.
    // The #707070 grey + ZERO shadows + no out-of-plate elements clauses are
    // what make that flood fill produce a clean transparent cutout. Anything
    // softer in the prompt and utensils / table surfaces leak through.
    const promptText = `Professional overhead food photography of "${dishName}".

STRICT TECHNICAL SPECIFICATIONS:
Camera & Composition:
- Angle: Overhead shot, camera at 90° directly above plate
- Framing: Plate perfectly centered, complete rim visible with margin
- Size: Food covers 60-70% of plate surface
- Format: Square 1:1 ratio

Plate (CRITICAL - MUST FOLLOW EXACTLY):
${hasMasterPlate ? '- REFERENCE IMAGE PROVIDED: Use the EXACT same plate from the reference image — identical shape, color, texture, and rim style. Do not deviate in any way.' : '- Plate: Round warm beige/cream stoneware dinner plate (10-11 inches)'}
- Plate color: Warm sandy beige (#E8D5B7) — NOT white, NOT grey
- Plate MUST have a clearly visible raised rim/edge all the way around
- The plate must be IDENTICAL style across all images: same warm beige stoneware
- EVERY image must show the COMPLETE plate with full rim visible — never cropped

Food & Styling:
- Professional restaurant plating, appetizing presentation
- Food centered on plate with realistic portions
- Lighting: Perfectly even flat lighting from all directions — ZERO shadows
- Quality: Sharp, photorealistic, high detail, 8K quality

Background (CRITICAL):
- Background: Solid DARK GREY (#707070) seamless studio backdrop
- Must be clearly DARKER than the beige plate (high contrast between plate edge and background)
- MUST be perfectly uniform grey — no gradients, no textures
- ABSOLUTELY NO SHADOWS anywhere — not under the plate, not around the plate, nowhere
- The plate edge must transition DIRECTLY to the flat grey background with zero shadow

Strict Exclusions:
- NO white plates — use warm beige/sandy stoneware ONLY
- NO light grey backgrounds — must be dark grey (#707070)
- NO SHADOWS of any kind — no drop shadows, no cast shadows, no ambient shadows
- NO table surfaces, wood, marble, or cloth
- NO utensils, napkins, garnishes outside plate
- NO hands, people, or decorative elements
- NO text, watermarks, labels
- NO angled views — strictly 90° overhead only

Style: Minimalist Scandinavian food photography, flat-lit product shot, clean and professional.`;

    const parts = [{ text: promptText }];
    if (hasMasterPlate) {
        const plateData = fs.readFileSync(MASTER_PLATE_REF_PATH).toString('base64');
        parts.push({ inlineData: { mimeType: 'image/png', data: plateData } });
        console.log('  🎨 Using master plate reference for consistent style');
    }

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: [{ role: 'user', parts }],
            // Text channel is kept so refusal/error messages surface in logs;
            // aspectRatio enforces the 1:1 framing the prompt asks for.
            config: {
                responseModalities: ['Text', 'Image'],
                imageConfig: { aspectRatio: '1:1' },
            },
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
            .extend({ top: Math.floor((IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2), bottom: Math.ceil((IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2), left: Math.floor((IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2), right: Math.ceil((IMAGE_SIZE_PX-PLATE_RESIZE_PX)/2), background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9 }).toBuffer(); // PNG-32 (full RGB+alpha) — palette mode banded the food photos

        fs.writeFileSync(outputPath, finalBuffer);
        await uploadToSupabase('images_nobg', `${day}/${slug}.png`, finalBuffer);
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

    const promptText = `Analyze this dish: "${dishName}"

Do ALL of the following in one response:

1. ORIGIN: Identify the single country this dish most likely originated from. Always provide a best guess — never refuse. Use ingredients, cooking style, or cultural context as clues.

2. DESCRIPTION: Write a single short appetizing description (max 20 words). Be warm and inviting, mention a key flavor or texture. Provide in both English and Norwegian.

3. VALIDATION: Is this a real dish name, or is it a category/theme header (like "THE MEDITERRANEAN SEA", "ASIAN STREET FOOD", "COMFORT FOOD")? If it's NOT a real dish, set isValidDish to false.

Respond ONLY with raw JSON:
{"origin":{"country":"Italy","code":"it"},"description":{"en":"English description","no":"Norwegian description"},"isValidDish":true}

"code" must be an ISO 3166-1 alpha-2 country code in lowercase.`;

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: { responseMimeType: 'application/json' },
        }), `analyze: ${dishName}`);
        const text = response.candidates[0].content.parts[0].text.trim();
        const parsed = JSON.parse(text);
        if (parsed.origin?.country && parsed.origin?.code && parsed.description?.en && parsed.description?.no) {
            return parsed;
        }
        return null;
    } catch (error) {
        console.error(`  ❌ Dish analysis failed for "${dishName}": ${error.message}`);
        return null;
    }
}

async function cleanDishTitles(menu) {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) { console.log('  ⚠️  GEMINI_API_KEY not set — skipping title cleanup'); return {}; }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // Collect all unique dish strings across both languages
    const allDishes = new Set();
    for (const canteen of Object.values(menu.canteens)) {
        for (const dayEntry of canteen.menu) {
            for (const lang of ['no', 'en']) {
                for (const item of (dayEntry[lang]?.items || [])) {
                    if (item.dish && !isDishClosed(item.dish)) {
                        allDishes.add(item.dish);
                    }
                }
            }
        }
    }
    if (allDishes.size === 0) return {};

    const dishList = [...allDishes];
    const promptText = `You are a proofreader for a workplace canteen menu.

Fix ONLY clear typos or joined compound words in Norwegian.
DO NOT rephrase. DO NOT translate. DO NOT change words that look correct.
If a title has no obvious typos, do NOT include it.

Titles to proofread:
${dishList.map((d, i) => `${i + 1}. "${d}"`).join('\n')}

Respond with ONLY a JSON object containing entries where corrections were made.
Format: {"original title": "corrected title"}
If nothing needs fixing, respond with {}`;

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-2.5-flash-lite',
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            config: { responseMimeType: 'application/json' },
        }), 'title cleanup');
        const text = response.candidates[0].content.parts[0].text.trim();
        const corrections = JSON.parse(text);

        // Validate: only keep corrections where the key actually exists in our dish list
        // and the model actually changed something (avoids no-op rewrites).
        const valid = {};
        for (const [original, corrected] of Object.entries(corrections)) {
            if (allDishes.has(original) && typeof corrected === 'string' && corrected !== original && corrected.length > 0) {
                valid[original] = corrected;
            }
        }
        return valid;
    } catch (error) {
        console.error(`  ⚠️  Title cleanup failed: ${error.message} — using raw titles`);
        return {};
    }
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

    console.log('\n🔍 Loading dish cache + listing storage in parallel...');
    const [dishCache, nobgIndex, archiveIndex] = await Promise.all([
        loadDishCache(),
        listDayContents('images_nobg', DAY_ORDER),
        // 'archive' is a flat folder of <cache_key>.png files. Reusing
        // listDayContents — the function name is a slight misnomer but the
        // shape is identical.
        listDayContents('images_nobg', ['archive']),
    ]);
    const archiveFiles = archiveIndex.archive || new Set();
    console.log(`  📚 ${Object.keys(dishCache).length} cache rows · ${archiveFiles.size} archive files`);

    // Four buckets of work:
    //   - skip:     slot has the right image AND cache row exists → no work
    //   - backfill: slot has the right image but cache row is missing → copy slot → archive (no API call)
    //   - cacheHit: slot needs an image we've generated before → copy archive → slot
    //   - regen:    new dish or missing archive → call Gemini
    const skip = [], backfill = [], cacheHits = [], regen = [];

    for (const [canteenName, newCanteen] of Object.entries(newMenu.canteens)) {
        const oldCanteen = oldMenu?.canteens?.[canteenName];
        const newDishes = getMainDishes(newCanteen);
        const oldDishes = oldCanteen ? getMainDishes(oldCanteen) : {};
        const slug = canteenName.toLowerCase().replace(/\s+/g, '_');

        for (const day of DAY_ORDER) {
            const newDish = newDishes[day];
            if (!newDish || isDishClosed(newDish)) continue;

            const cacheKey = normalizeDishName(newDish);
            const slotPath = `${day}/${slug}.png`;
            const slotExists = nobgIndex[day]?.has(`${slug}.png`) || false;
            const dishUnchanged = normalizeDishName(oldDishes[day]) === cacheKey;
            const cached = dishCache[cacheKey];
            // A cache row alone isn't enough — the archive file it points at
            // must actually exist. Catches half-written cache state from past
            // failed copies.
            const cachedImageFresh = !!(
                cached?.image_path && cached?.image_nobg_path && archiveFiles.has(`${cacheKey}.png`)
            );

            if (slotExists && dishUnchanged) {
                if (cachedImageFresh) {
                    skip.push({ canteenName, day, newDish });
                } else {
                    // Slot is correct but cache doesn't know about it. Copy slot →
                    // archive so future weeks can reuse this image as a cache hit.
                    backfill.push({ canteenName, day, slug, slotPath, newDish, cacheKey });
                }
                continue;
            }

            if (cachedImageFresh) {
                cacheHits.push({ canteenName, day, slug, slotPath, newDish, cacheKey, cached });
            } else {
                regen.push({ canteenName, day, slug, slotPath, newDish, cacheKey });
            }
        }
    }

    console.log(`  ⏭️  ${skip.length} unchanged · 📦 ${backfill.length} cache backfill · ♻️  ${cacheHits.length} cache hits · 🔄 ${regen.length} need generation`);

    // Backfill: slot is correct but archive/cache row is missing. Copy slot → archive.
    if (backfill.length > 0) {
        await asyncPool(6, backfill, async (b) => {
            const archivePath = `archive/${b.cacheKey}.png`;
            const okBg = await copyInBucket('images', b.slotPath, archivePath);
            const okNobg = await copyInBucket('images_nobg', b.slotPath, archivePath);
            if (okBg && okNobg) {
                await saveDishCacheEntry({
                    cache_key: b.cacheKey,
                    original_name: b.newDish,
                    image_path: archivePath,
                    image_nobg_path: archivePath,
                });
                dishCache[b.cacheKey] = {
                    cache_key: b.cacheKey,
                    original_name: b.newDish,
                    image_path: archivePath,
                    image_nobg_path: archivePath,
                };
            }
        });
        console.log(`  📦 backfilled ${backfill.length} cache entries from existing slots`);
    }

    // Cache hits: copy archive → slot in parallel (network only, no API).
    if (cacheHits.length > 0) {
        console.log(`\n♻️  Copying ${cacheHits.length} cached images into current-week slots...`);
        await asyncPool(6, cacheHits, async (c) => {
            const okBg = await copyInBucket('images', c.cached.image_path, c.slotPath);
            const okNobg = await copyInBucket('images_nobg', c.cached.image_nobg_path, c.slotPath);
            if (okBg && okNobg) {
                console.log(`  ♻️  ${c.canteenName}/${c.day}: ${c.newDish.substring(0, 40)}`);
            } else {
                console.log(`  ⚠️  cache copy failed for ${c.cacheKey} — falling back to regen`);
                regen.push(c);
            }
        });
    }

    // Misses: generate, archive, upsert. Parallel with concurrency=3.
    // Higher = bumping into Gemini per-minute rate limits and Playwright RAM.
    if (regen.length === 0) {
        console.log('\n✅ No images need generating.');
    } else {
        console.log(`\n🔄 Generating ${regen.length} new images (concurrency=3)...`);
        const results = await asyncPool(3, regen, async (c) => {
            console.log(`📸 ${c.canteenName}/${c.day}: ${c.newDish.substring(0, 40)}...`);
            const generated = await generateSingleImage(c.newDish, c.canteenName, c.day);
            if (!generated) return { ok: false, reason: 'generation' };
            const removed = await removeBgSingle(c.canteenName, c.day);
            if (!removed) return { ok: false, reason: 'bg-removal' };

            // Archive both variants under cache_key so future weeks can reuse them.
            const archivePath = `archive/${c.cacheKey}.png`;
            await copyInBucket('images', c.slotPath, archivePath);
            await copyInBucket('images_nobg', c.slotPath, archivePath);

            await saveDishCacheEntry({
                cache_key: c.cacheKey,
                original_name: c.newDish,
                image_path: archivePath,
                image_nobg_path: archivePath,
            });
            // Update in-memory cache so a duplicate dish later in this run is a hit.
            dishCache[c.cacheKey] = {
                cache_key: c.cacheKey,
                original_name: c.newDish,
                image_path: archivePath,
                image_nobg_path: archivePath,
            };
            console.log(`  ✅ ${c.canteenName}/${c.day} done & archived`);
            return { ok: true };
        });

        const failures = results.filter(r => !r.ok && r.value?.ok === false);
        if (failures.length) console.log(`  ⚠️  ${failures.length} regen failures`);
    }

    console.log('\n🍽️  Checking closed days...');
    for (const [canteenName, canteen] of Object.entries(newMenu.canteens)) {
        for (const day of DAY_ORDER) {
            const entry = canteen.menu.find(d => d.day.toLowerCase() === day);
            const items = getDayItems(entry);
            const main = items.find(i => i.isMain);
            if (main && !isDishClosed(main.dish)) continue;
            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const staticSrc = path.join(__dirname, 'public', 'images', 'closed-plates', `closed-plate-1.png`);
            if (fs.existsSync(staticSrc)) {
                const buffer = fs.readFileSync(staticSrc);
                await uploadToSupabase('images', `${day}/${slug}.png`, buffer);
                await uploadToSupabase('images_nobg', `${day}/${slug}.png`, buffer);
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
    // Hydrate origins/descriptions from dishCache first (free, no API call),
    // then call analyzeDish only for dishes neither cache nor file knows about.
    const toAnalyze = [];
    for (const name of allDishNames) {
        const cacheKey = normalizeDishName(name);
        const cached = dishCache[cacheKey];
        if (cached?.origin && !origins[name]) origins[name] = cached.origin;
        if (cached?.description && !descriptions[name]) descriptions[name] = cached.description;
        if (!origins[name] || !descriptions[name]) toAnalyze.push({ name, cacheKey });
    }

    if (toAnalyze.length) {
        console.log(`  🤖 analyzing ${toAnalyze.length} new dishes (concurrency=3)`);
        await asyncPool(3, toAnalyze, async ({ name, cacheKey }) => {
            const res = await analyzeDish(name);
            if (!res) return;
            origins[name] = res.origin;
            descriptions[name] = res.description;
            // Persist in dish_cache so future runs skip the API call.
            await saveDishCacheEntry({
                cache_key: cacheKey,
                original_name: name,
                origin: res.origin,
                description: res.description,
            });
        });
    }
    // Persist menu + origins + descriptions to weekly_menus.
    // The frontend reads this row server-side — Supabase is now the single
    // source of truth (no more workflow-committed JSON files in /public).
    //
    // Picking the week number is fiddly: Flow's canteen page hard-codes
    // "BYGG / BUILDING B - UKE/WEEK 17" and never updates it, so reading
    // canteens[0].week is unreliable. Take the max across canteens whose
    // value parses to something sensible — this also correctly catches the
    // Friday case where canteens publish next week's menu ahead of time.
    const reportedWeeks = Object.values(newMenu.canteens)
        .map(c => parseMenuWeekNumber(c.week))
        .filter(w => Number.isFinite(w) && w >= 1 && w <= 53);
    const targetWeek = reportedWeeks.length ? Math.max(...reportedWeeks) : getCurrentISOWeek();
    if (targetWeek && supabase) {
        const isoYear = getISOWeekYearFromDate(new Date());
        const weekId = `${isoYear}-W${String(targetWeek).padStart(2, '0')}`;
        const { error } = await supabase
            .from('weekly_menus')
            .upsert(
                { week_id: weekId, menu_data: newMenu, dish_origins: origins, dish_descriptions: descriptions },
                { onConflict: 'week_id' }
            );
        if (error) console.error(`  ❌ weekly_menus upsert failed: ${error.message}`);
        else console.log(`💾 saved ${weekId} (${Object.keys(origins).length} origins, ${Object.keys(descriptions).length} descriptions)`);
    } else {
        console.warn('⚠️  weekly_menus upsert skipped (no week number or supabase client)');
    }
    console.log('\n🏁 FINISHED');
}

if (require.main === module) {
    main().catch(console.error);
}

// Exposed for one-off scripts (e.g. scripts/force-regen-current.js).
module.exports = {
    generateSingleImage,
    removeBgSingle,
    getDayItems,
    isDishClosed,
    DAY_ORDER,
    IMAGES_DIR,
    IMAGES_NOBG_DIR,
};
