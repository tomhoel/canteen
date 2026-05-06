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

// Supabase Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) 
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false
        },
        // Disable realtime to avoid WebSocket error in Node < 22 environments
        realtime: {
            params: {
                eventsPerSecond: 0
            }
        }
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
const PLATE_RESIZE_PX = 880; // 86% of canvas for nice margin

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
 * Extract main dish names per day for a canteen.
 * Returns { monday: "Chicken jalfrezi...", tuesday: "Cod with...", ... }
 */
/**
 * Pick the best items array for a day entry — prefer English, fall back to Norwegian.
 * Empty arrays are treated as "no items" ([] is truthy in JS but has no content).
 */
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

/**
 * Returns the ISO week number for an arbitrary date string.
 */
function getISOWeekFromDate(dateStr) {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function findChanges(oldMenu, newMenu) {
    const changes = []; // { canteenName, day, oldDish, newDish }

    // Detect week-boundary crossing: old menu scraped in a previous ISO week.
    // When canteens publish next week's menu early ("ahead"), closed-plate images
    // are placed. Once the actual week arrives we must regenerate real food images
    // even if the dish text hasn't changed.
    const oldScrapedWeek = oldMenu?.scrapedAt ? getISOWeekFromDate(oldMenu.scrapedAt) : null;
    const currentWeek = getCurrentISOWeek();
    const crossedWeekBoundary = oldScrapedWeek !== null && oldScrapedWeek < currentWeek;

    for (const [canteenName, newCanteen] of Object.entries(newMenu.canteens)) {
        const oldCanteen = oldMenu?.canteens?.[canteenName];

        if (!oldCanteen) {
            // Entirely new canteen — regenerate all days
            for (const day of DAY_ORDER) {
                const entry = newCanteen.menu.find(d => d.day.toLowerCase() === day);
                const items = getDayItems(entry);
                const main = items.find(i => i.isMain);
                if (main && !isDishClosed(main.dish)) {
                    changes.push({ canteenName, day, oldDish: null, newDish: main.dish });
                }
            }
            continue;
        }

        const oldDishes = getMainDishes(oldCanteen);
        const newDishes = getMainDishes(newCanteen);

        // Check week change
        const oldWeek = oldCanteen.week || '';
        const newWeek = newCanteen.week || '';
        const weekChanged = oldWeek !== newWeek;

        // Force regeneration if we crossed a week boundary and this canteen's
        // menu is for the current week (was likely "ahead" before, now current)
        const canteenWeek = parseMenuWeekNumber(newCanteen.week);
        const forceRegenerate = crossedWeekBoundary && canteenWeek === currentWeek;

        for (const day of DAY_ORDER) {
            const oldDish = oldDishes[day];
            const newDish = newDishes[day];

            if (!newDish) continue;

            // Skip closed-keyword dishes — Step 4b handles those
            if (isDishClosed(newDish)) continue;

            // Regenerate if: dish changed, week changed, image missing, or week transition
            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const imagePath = path.join(IMAGES_NOBG_DIR, day, `${slug}.png`);
            const imageExists = fs.existsSync(imagePath);

            if (oldDish !== newDish || weekChanged || !imageExists || forceRegenerate) {
                const reason = forceRegenerate ? 'week transition (replacing closed plate)'
                    : !imageExists ? 'missing image'
                    : weekChanged ? `week: ${oldWeek} → ${newWeek}`
                    : 'dish changed';
                changes.push({ canteenName, day, oldDish, newDish, reason });
            }
        }
    }

    return changes;
}

/**
 * Returns the current ISO week number (1-53).
 */
function getCurrentISOWeek() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

/**
 * Parse week number from strings like "UKE/WEEK 13", "Week 13", "Uke 13", etc.
 * Returns null if no number found.
 */
function parseMenuWeekNumber(weekStr) {
    const match = weekStr && weekStr.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Validate scraped menu data before overwriting.
 * Returns { valid: boolean, issues: string[] }
 */
function validateMenu(menu) {
    const issues = [];

    if (!menu || !menu.canteens) {
        issues.push('Menu data is null or missing canteens object');
        return { valid: false, issues };
    }

    const canteenNames = Object.keys(menu.canteens);
    if (canteenNames.length === 0) {
        issues.push('No canteens found in scraped data');
        return { valid: false, issues };
    }

    for (const expected of EXPECTED_CANTEENS) {
        if (!menu.canteens[expected]) {
            issues.push(`Missing expected canteen: ${expected}`);
        }
    }

    for (const [name, canteen] of Object.entries(menu.canteens)) {
        if (!canteen.menu || canteen.menu.length === 0) {
            issues.push(`${name}: No menu entries`);
            continue;
        }

        let dishCount = 0;
        for (const dayEntry of canteen.menu) {
            const items = dayEntry?.en?.items || dayEntry?.no?.items || [];
            dishCount += items.length;
        }

        if (dishCount === 0) {
            issues.push(`${name}: Zero dishes across all days`);
        }

        const daysWithDishes = canteen.menu.filter(dayEntry => {
            const items = dayEntry?.en?.items || dayEntry?.no?.items || [];
            return items.some(i => i.isMain);
        }).length;
        if (daysWithDishes > 0 && daysWithDishes < 3) {
            issues.push(`${name}: Only ${daysWithDishes}/5 days have main dishes (expected ≥ 3)`);
        }
    }

    // Allow partial data (some canteens missing) but not total failure
    const hasSomeData = canteenNames.some(name => {
        const canteen = menu.canteens[name];
        const totalItems = (canteen.menu || []).reduce((sum, day) => {
            return sum + (day?.en?.items?.length || 0) + (day?.no?.items?.length || 0);
        }, 0);
        return totalItems > 0;
    });

    return { valid: hasSomeData, issues };
}

// Path to master plate reference image for consistent plate style across all generations
const MASTER_PLATE_REF_PATH = path.join(__dirname, 'public', 'images', 'master-plate-ref.png');

/**
 * Upload a file buffer to Supabase Storage.
 * Replaces existing file if it exists.
 */
async function uploadToSupabase(bucket, path, buffer, contentType = 'image/png') {
    if (!supabase) return false;
    try {
        const { error } = await supabase.storage
            .from(bucket)
            .upload(path, buffer, {
                contentType,
                upsert: true
            });
        if (error) throw error;
        return true;
    } catch (err) {
        console.error(`  ❌ Supabase upload failed (${path}): ${err.message}`);
        return false;
    }
}

/**
 * Generate a single image using the V3 generator prompt.
 * If master-plate-ref.png exists, it is passed as a visual reference to Gemini
 * so it can replicate the exact plate style rather than interpreting text alone.
 */
async function generateSingleImage(dishName, canteenName, day) {
    const { GoogleGenAI } = require('@google/genai');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) { console.error('  ❌ GEMINI_API_KEY required'); return false; }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const hasMasterPlate = fs.existsSync(MASTER_PLATE_REF_PATH);

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
            contents: { parts },
            config: { 
                responseModalities: ['Text', 'Image'], 
                imageConfig: { imageSize: '1024px' } 
            },
        }), `image: ${dishName}`);

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const sharp = require('sharp');
                const raw = Buffer.from(part.inlineData.data, 'base64');
                const pngBuffer = await sharp(raw).png().toBuffer();
                const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
                const dayDir = path.join(IMAGES_DIR, day);
                if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
                fs.writeFileSync(path.join(dayDir, `${slug}.png`), pngBuffer);
                
                // Upload high-res original to Supabase
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

/**
 * Remove background for a single image using Sharp.
 * Uses flood-fill from edges with an index-based queue for performance.
 */
async function removeBgSingle(canteenName, day) {
    const sharp = require('sharp');
    const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
    const inputPath = path.join(IMAGES_DIR, day, `${slug}.png`);
    const outputDir = path.join(IMAGES_NOBG_DIR, day);
    const outputPath = path.join(outputDir, `${slug}.png`);

    if (!fs.existsSync(inputPath)) return false;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    try {
        const { data, info } = await sharp(inputPath)
            .raw().ensureAlpha().toBuffer({ resolveWithObject: true });
        const { width, height, channels } = info;
        const totalPixels = width * height;

        // Flood fill from edges — check visited BEFORE enqueuing to prevent
        // queue overflow (each pixel enqueued at most once → queue stays ≤ totalPixels)
        const visited = new Uint8Array(totalPixels);
        const isBg = new Uint8Array(totalPixels);
        const queue = new Int32Array(totalPixels);
        let qHead = 0, qTail = 0;

        const enqueue = (idx) => {
            if (idx >= 0 && idx < totalPixels && !visited[idx]) {
                visited[idx] = 1;
                queue[qTail++] = idx;
            }
        };

        for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x); }
        for (let y = 1; y < height - 1; y++) { enqueue(y * width); enqueue(y * width + width - 1); }

        while (qHead < qTail) {
            const idx = queue[qHead++];
            const pi = idx * channels;
            const r = data[pi], g = data[pi + 1], b = data[pi + 2];
            const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            const brightness = (r + g + b) / 3;
            // Background is dark grey #707070 (approx 112, 112, 112)
            if (!(maxDiff < 50 && brightness <= 185)) continue;
            isBg[idx] = 1;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0) enqueue(idx - 1);
            if (x < width - 1) enqueue(idx + 1);
            if (y > 0) enqueue(idx - width);
            if (y < height - 1) enqueue(idx + width);
        }

        // Keep largest blob
        const blobId = new Int32Array(totalPixels).fill(-1);
        const blobSizes = [];
        let currentBlob = 0;
        for (let i = 0; i < totalPixels; i++) {
            if (isBg[i] || blobId[i] >= 0) continue;
            const q = [i]; let size = 0;
            while (q.length) {
                const idx = q.pop();
                if (idx < 0 || idx >= totalPixels || isBg[idx] || blobId[idx] >= 0) continue;
                blobId[idx] = currentBlob; size++;
                const x = idx % width, y = Math.floor(idx / width);
                if (x > 0) q.push(idx - 1); if (x < width - 1) q.push(idx + 1);
                if (y > 0) q.push(idx - width); if (y < height - 1) q.push(idx + width);
            }
            blobSizes.push(size); currentBlob++;
        }
        if (blobSizes.length > 0) {
            let largest = 0;
            for (let b = 1; b < blobSizes.length; b++) if (blobSizes[b] > blobSizes[largest]) largest = b;
            for (let i = 0; i < totalPixels; i++) if (!isBg[i] && blobId[i] !== largest) isBg[i] = 1;
        }

        // Erode gray fringe: expand background mask into adjacent gray-ish pixels
        // that the flood-fill missed (anti-aliased plate edges, slight gradients)
        for (let pass = 0; pass < 3; pass++) {
            const expansion = new Uint8Array(totalPixels);
            for (let i = 0; i < totalPixels; i++) {
                if (isBg[i]) continue;
                const pi = i * channels;
                const r = data[pi], g = data[pi + 1], b = data[pi + 2];
                const md = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
                const br = (r + g + b) / 3;
                if (md >= 40 || br > 160) continue; // not gray-ish, skip
                const x = i % width, y = Math.floor(i / width);
                if ((x > 0 && isBg[i - 1]) || (x < width - 1 && isBg[i + 1]) ||
                    (y > 0 && isBg[i - width]) || (y < height - 1 && isBg[i + width])) {
                    expansion[i] = 1;
                }
            }
            for (let i = 0; i < totalPixels; i++) if (expansion[i]) isBg[i] = 1;
        }

        // Apply transparency
        for (let i = 0; i < totalPixels; i++) {
            if (isBg[i]) data[i * channels + 3] = 0;
        }

        // Standardize plate size: trim transparency, scale precisely, and compose onto high-res canvas
        const trimmedBuffer = await sharp(data, { raw: { width, height, channels } })
            .trim()
            .resize(PLATE_RESIZE_PX, PLATE_RESIZE_PX, { fit: 'inside' })
            .png()
            .toBuffer();

        const finalBuffer = await sharp({
            create: {
                width: IMAGE_SIZE_PX,
                height: IMAGE_SIZE_PX,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{ input: trimmedBuffer, gravity: 'center' }])
        .png({ compressionLevel: 9, palette: true })
        .toBuffer();

        fs.writeFileSync(outputPath, finalBuffer);
        
        // Upload processed image to Supabase
        await uploadToSupabase('images-nobg', `${day}/${slug}.png`, finalBuffer);

        return true;
    } catch (error) {
        console.error(`  ❌ BG removal failed: ${error.message}`);
        return false;
    }
}

/**
 * Analyze a dish in a single API call: detect origin, generate description,
 * and validate that it's a real dish (not a theme/category header).
 * Merges what were previously two separate API calls into one.
 * Returns { origin: {country, code}, description: {en, no} } or null on failure.
 */
async function analyzeDish(dishName) {
    const { GoogleGenAI } = require('@google/genai');
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
            model: 'gemini-1.5-flash',
            contents: { parts: [{ text: promptText }] },
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

/**
 * Clean dish titles using Gemini — fixes typos, compound words, capitalization.
 * Sends all unique titles in a single API call for efficiency.
 * Returns a map of { "original title": "corrected title" } (only entries that changed).
 */
async function cleanDishTitles(menu) {
    const { GoogleGenAI } = require('@google/genai');
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
    const promptText = `You are a proofreader for a Norwegian workplace canteen menu. The titles below were scraped from a website and may contain errors.

Fix ONLY these types of issues:
- Typos (e.g. "Ppork" → "Pork", "wiith" → "with", "ruccula" → "rucola")
- Norwegian compound words that must be joined (e.g. "tomat suppe" → "tomatsuppe", "karri saus" → "karrisaus", "sitron potet" → "sitronpotet")
- Capitalization errors (e.g. "Bbq" → "BBQ", random mid-word capitals)
- Duplicate words (e.g. "and and rice" → "and rice")
- Obviously missing small words (e.g. "Kikertgryte ris" → "Kikertgryte med ris")

CRITICAL RULES:
- Be CONSERVATIVE. Only fix clear, obvious errors.
- Do NOT rephrase, rewrite, or improve wording.
- Do NOT translate between Norwegian and English.
- Do NOT change dish names, cooking terms, or foreign words that are intentional (e.g. keep "Stracotta", "jalfrezi", "Dan Dan" as-is).
- Do NOT change the overall structure or word order.
- If a title has no errors, do NOT include it in the output.

Titles to proofread:
${dishList.map((d, i) => `${i + 1}. "${d}"`).join('\n')}

Respond with ONLY a JSON object containing entries where corrections were made.
Format: {"original title": "corrected title"}
If nothing needs fixing, respond with {}`;

    try {
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-1.5-flash',
            contents: { parts: [{ text: promptText }] },
            config: { responseMimeType: 'application/json' },
        }), 'title cleanup');

        const text = response.candidates[0].content.parts[0].text.trim();
        const corrections = JSON.parse(text);

        // Validate: only keep corrections where the key actually exists in our dish list
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

/**
 * Apply title corrections to all matching dish entries in the menu.
 * Returns the number of individual item titles updated.
 */
function applyTitleCorrections(menu, corrections) {
    let count = 0;
    for (const canteen of Object.values(menu.canteens)) {
        for (const dayEntry of canteen.menu) {
            for (const lang of ['no', 'en']) {
                for (const item of (dayEntry[lang]?.items || [])) {
                    if (item.dish && corrections[item.dish]) {
                        item.dish = corrections[item.dish];
                        count++;
                    }
                }
            }
        }
    }
    return count;
}

/**
 * Archive the current week's data before the new week overwrites it.
 * Receives oldMenu from memory — do not re-read disk (scraper already overwrote it).
 * Non-fatal: logs a warning and continues if anything fails.
 */
async function archiveCurrentWeek(oldMenu) {
    // Derive ISO week year from scrapedAt timestamp
    const d = new Date(oldMenu.scrapedAt);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
    const weekKey = `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    const archiveDir = path.join(HISTORY_DIR, weekKey);

    if (fs.existsSync(archiveDir)) {
        console.log(`  ⏭️  Archive already exists for ${weekKey} — skipping local`);
    } else {
        try {
            fs.mkdirSync(archiveDir, { recursive: true });
            fs.writeFileSync(path.join(archiveDir, 'menu.json'), JSON.stringify(oldMenu, null, 2));
            for (const file of ['dish-descriptions.json', 'dish-origins.json']) {
                const src = path.join(__dirname, 'public', file);
                if (fs.existsSync(src)) fs.copyFileSync(src, path.join(archiveDir, file));
            }
            for (const imagesDir of [IMAGES_DIR, IMAGES_NOBG_DIR]) {
                const dirName = path.basename(imagesDir);
                for (const day of DAY_ORDER) {
                    const srcDay = path.join(imagesDir, day);
                    if (!fs.existsSync(srcDay)) continue;
                    const destDay = path.join(archiveDir, dirName, day);
                    fs.mkdirSync(destDay, { recursive: true });
                    for (const file of fs.readdirSync(srcDay)) {
                        fs.copyFileSync(path.join(srcDay, file), path.join(destDay, file));
                    }
                }
            }
            console.log(`  📦 Archived ${weekKey} → public/history/${weekKey}/`);
        } catch (err) {
            console.warn(`  ⚠️  Local archive failed for ${weekKey}: ${err.message}`);
        }
    }

    // Supabase Archiving
    if (supabase) {
        console.log(`  ☁️  Archiving ${weekKey} to Supabase...`);
        try {
            // menu.json
            await uploadToSupabase('history', `${weekKey}/menu.json`, Buffer.from(JSON.stringify(oldMenu, null, 2)), 'application/json');
            
            // images and images_nobg
            for (const day of DAY_ORDER) {
                for (const bucket of ['images', 'images-nobg']) {
                    const localDir = bucket === 'images' ? IMAGES_DIR : IMAGES_NOBG_DIR;
                    const dayDir = path.join(localDir, day);
                    if (!fs.existsSync(dayDir)) continue;
                    
                    for (const file of fs.readdirSync(dayDir)) {
                        const buffer = fs.readFileSync(path.join(dayDir, file));
                        await uploadToSupabase('history', `${weekKey}/${bucket}/${day}/${file}`, buffer);
                    }
                }
            }
            console.log(`  ✅ Supabase archive complete for ${weekKey}`);
        } catch (err) {
            console.warn(`  ⚠️  Supabase archive failed for ${weekKey}: ${err.message}`);
        }
    }
}

async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  SMART WEEKLY UPDATE                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // Step 1: Load old menu
    let oldMenu = null;
    if (fs.existsSync(MENU_PATH)) {
        oldMenu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
        console.log(`📋 Old menu: scraped ${oldMenu.scrapedAt}`);
        for (const [name, data] of Object.entries(oldMenu.canteens)) {
            console.log(`   ${name}: ${data.week}`);
        }
    } else {
        console.log('📋 No existing menu — will generate everything');
    }

    // Load origins + descriptions cache
    const origins = fs.existsSync(ORIGINS_PATH)
        ? JSON.parse(fs.readFileSync(ORIGINS_PATH, 'utf8'))
        : {};
    const descriptions = fs.existsSync(DESCRIPTIONS_PATH)
        ? JSON.parse(fs.readFileSync(DESCRIPTIONS_PATH, 'utf8'))
        : {};

    // Step 2: Scrape new menu
    console.log('\n📥 Scraping fresh menu...');
    try {
        execSync('node scraper.js', { stdio: 'inherit' });
    } catch (e) {
        console.error('❌ Scraping failed');
        process.exit(1);
    }

    // Step 2b: Validate scraped data
    const newMenu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
    const validation = validateMenu(newMenu);

    if (validation.issues.length > 0) {
        console.log('\n⚠️  Validation issues:');
        for (const issue of validation.issues) {
            console.log(`   - ${issue}`);
        }
    }

    if (!validation.valid) {
        console.error('\n❌ Scraped data failed validation — aborting to preserve existing menu');
        if (oldMenu) {
            fs.writeFileSync(MENU_PATH, JSON.stringify(oldMenu, null, 2));
            console.log('   Restored previous menu.json');
        }
        process.exit(1);
    }

    // Carry forward old canteen data for any canteen that failed to scrape
    if (oldMenu) {
        for (const expected of EXPECTED_CANTEENS) {
            if (!newMenu.canteens[expected] && oldMenu.canteens[expected]) {
                newMenu.canteens[expected] = oldMenu.canteens[expected];
                console.log(`  ♻️  Carried forward old data for: ${expected}`);
            }
        }
        // Re-save in case we merged old data in
        fs.writeFileSync(MENU_PATH, JSON.stringify(newMenu, null, 2));
    }

    // Step 2b½: Clean dish titles (fix typos, compound words, capitalization)
    // Runs BEFORE diff so that clean titles are compared against previously-clean titles,
    // and clean titles flow into image generation prompts and cache keys.
    console.log('\n✏️  Cleaning dish titles...');
    const corrections = await cleanDishTitles(newMenu);
    const correctionCount = Object.keys(corrections).length;
    if (correctionCount > 0) {
        for (const [original, corrected] of Object.entries(corrections)) {
            console.log(`  ✏️  "${original}" → "${corrected}"`);
        }
        const applied = applyTitleCorrections(newMenu, corrections);
        fs.writeFileSync(MENU_PATH, JSON.stringify(newMenu, null, 2));
        console.log(`  💾 Applied ${correctionCount} corrections (${applied} title instances updated)`);
    } else {
        console.log('  ✓ All titles look clean');
    }

    console.log(`\n📋 New menu: scraped ${newMenu.scrapedAt}`);
    for (const [name, data] of Object.entries(newMenu.canteens)) {
        console.log(`   ${name}: ${data.week}`);
    }

    // Step 2c: Log week status per canteen (ahead canteens get isAhead flag in the frontend)
    const currentISOWeek = getCurrentISOWeek();
    for (const [canteenName, canteen] of Object.entries(newMenu.canteens)) {
        const weekNum = parseMenuWeekNumber(canteen.week);
        if (weekNum !== null && weekNum > currentISOWeek) {
            console.log(`  ℹ️  ${canteenName}: week ${weekNum} (ahead of current ${currentISOWeek}) — shown with "ahead" badge`);
        }
    }

    // Step 2d: Clean up orphaned images (old slug names like the_hub.png, telenor_expo.png, bygg_b.png)
    for (const dir of [IMAGES_DIR, IMAGES_NOBG_DIR]) {
        for (const day of DAY_ORDER) {
            const dayDir = path.join(dir, day);
            if (!fs.existsSync(dayDir)) continue;
            for (const file of fs.readdirSync(dayDir)) {
                const slug = file.replace(/\.png$/i, '');
                if (!VALID_SLUGS.has(slug)) {
                    const orphanPath = path.join(dayDir, file);
                    fs.unlinkSync(orphanPath);
                    console.log(`  🗑️  Deleted orphan: ${path.relative(__dirname, orphanPath)}`);
                }
            }
        }
    }

    // Step 2e: Archive previous week if the week number changed
    // Compare parsed week numbers (not raw strings) to avoid false triggers
    // from unstable Object.entries() ordering across canteens
    if (oldMenu) {
        const oldWeekNum = parseMenuWeekNumber(Object.values(oldMenu.canteens)[0]?.week);
        const newWeekNum = parseMenuWeekNumber(Object.values(newMenu.canteens)[0]?.week);
        if (oldWeekNum !== null && newWeekNum !== null && oldWeekNum !== newWeekNum) {
            console.log(`\n📦 Week changed (${oldWeekNum} → ${newWeekNum}) — archiving previous week...`);
            await archiveCurrentWeek(oldMenu);
        }
    }

    // Step 3: Find changes
    const changes = findChanges(oldMenu, newMenu);

    if (changes.length === 0) {
        console.log('\n✅ No changes detected — everything is up to date!');
        console.log('   Skipping image generation entirely.');
    } else {
        // Group by canteen for display
        const byCanteen = {};
        for (const c of changes) {
            if (!byCanteen[c.canteenName]) byCanteen[c.canteenName] = [];
            byCanteen[c.canteenName].push(c);
        }

        console.log(`\n🔄 Changes detected: ${changes.length} images to regenerate`);
        console.log('═'.repeat(60));
        for (const [name, items] of Object.entries(byCanteen)) {
            console.log(`\n  🍽️  ${name} (${items.length} days):`);
            for (const c of items) {
                console.log(`     ${c.day}: ${c.reason || 'changed'}`);
                if (c.oldDish) console.log(`       Old: ${c.oldDish.substring(0, 50)}`);
                if (c.newDish) console.log(`       New: ${c.newDish.substring(0, 50)}`);
            }
        }

        const skipped = (Object.keys(newMenu.canteens).length * 5) - changes.length;
        console.log(`\n⏭️  Skipping ${skipped} images (already up to date)`);
        console.log('═'.repeat(60));

        // Step 4: Generate + remove BG only for changed items
        let generated = 0, failed = 0;

        for (const change of changes) {
            const displayDish = change.newDish.substring(0, 45);
            console.log(`\n📸 ${change.canteenName} / ${change.day}: ${displayDish}...`);

            const ok = await generateSingleImage(change.newDish, change.canteenName, change.day);
            if (ok) {
                console.log('  ✅ Generated');
                const bgOk = await removeBgSingle(change.canteenName, change.day);
                if (bgOk) {
                    console.log('  ✅ Background removed + optimized');
                    generated++;
                } else {
                    console.log('  ❌ Background removal failed');
                    failed++;
                }
            } else {
                console.log('  ❌ Generation failed');
                failed++;
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 1500));
        }

        console.log('\n' + '═'.repeat(60));
        console.log('📊 SMART UPDATE SUMMARY');
        console.log('═'.repeat(60));
        console.log(`✅ Regenerated: ${generated} images`);
        console.log(`⏭️  Skipped:     ${skipped} images (unchanged)`);
        if (failed > 0) console.log(`❌ Failed:      ${failed} images`);
        console.log(`💰 API calls saved: ${skipped} (vs full regeneration)`);
        console.log('═'.repeat(60));
    }

    // Step 4b: Place static closed-plate images for canteens/days with no menu.
    // Uses pre-generated static assets (no Gemini API calls).
    const CLOSED_PLATES_DIR = path.join(__dirname, 'public', 'images', 'closed-plates');
    const CLOSED_PLATE_COUNT = 3;
    console.log('\n🍽️  Checking for closed canteen days...');
    let closedPlaced = 0, closedSkipped = 0;
    const canteenNames = Object.keys(newMenu.canteens);
    for (const [canteenName, canteen] of Object.entries(newMenu.canteens)) {
        for (const day of DAY_ORDER) {
            const entry = canteen.menu.find(d => d.day.toLowerCase() === day);
            const items = getDayItems(entry);
            const main = items.find(i => i.isMain);

            // Skip canteens with real food — even if "ahead" (Change 2)
            if (main && !isDishClosed(main.dish)) continue;

            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const nobgPath = path.join(IMAGES_NOBG_DIR, day, `${slug}.png`);

            // Only place if the no-bg image is missing (avoids overwriting every run)
            if (fs.existsSync(nobgPath)) {
                closedSkipped++;
                continue;
            }

            // Pick a static closed plate (rotate by canteen index)
            const canteenIdx = canteenNames.indexOf(canteenName);
            const plateNum = (canteenIdx % CLOSED_PLATE_COUNT) + 1;
            const staticSrc = path.join(CLOSED_PLATES_DIR, `closed-plate-${plateNum}.png`);

            if (!fs.existsSync(staticSrc)) {
                console.log(`  ⚠️  Static closed plate not found: closed-plate-${plateNum}.png — skipping`);
                continue;
            }

            console.log(`  🍽️  ${canteenName} / ${day}: closed — placing static plate ${plateNum}`);
            const nobgDir = path.join(IMAGES_NOBG_DIR, day);
            if (!fs.existsSync(nobgDir)) fs.mkdirSync(nobgDir, { recursive: true });
            fs.copyFileSync(staticSrc, nobgPath);

            // Also place in images/ dir for high-res lightbox
            const imgDir = path.join(IMAGES_DIR, day);
            if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
            const highResPath = path.join(imgDir, `${slug}.png`);
            fs.copyFileSync(staticSrc, highResPath);

            // Upload to Supabase
            const buffer = fs.readFileSync(staticSrc);
            await uploadToSupabase('images', `${day}/${slug}.png`, buffer);
            await uploadToSupabase('images-nobg', `${day}/${slug}.png`, buffer);

            closedPlaced++;
        }
    }
    if (closedPlaced > 0 || closedSkipped > 0) {
        console.log(`  📊 Closed plates: ${closedPlaced} placed (static), ${closedSkipped} already exist`);
    } else {
        console.log('  ✓ No closed canteen days found');
    }

    // Step 5: Analyze all dishes — origin + description in a single API call per dish.
    // Previously this was two separate loops (2 calls per new dish), now merged into one.
    console.log('\n🔍 Analyzing dishes (origin + description)...');
    const allDishNames = new Set();
    for (const canteen of Object.values(newMenu.canteens)) {
        for (const dayEntry of canteen.menu) {
            const items = getDayItems(dayEntry);
            const main = items.find(i => i.isMain);
            if (main?.dish && !isDishClosed(main.dish)) allDishNames.add(main.dish);
        }
    }

    let originsUpdated = false, descriptionsUpdated = false;
    let analyzed = 0, analysisFailed = 0;
    for (const dishName of allDishNames) {
        const hasOrigin = !!origins[dishName];
        const hasDescription = !!descriptions[dishName];
        if (hasOrigin && hasDescription) {
            console.log(`  ✓ cached: ${dishName.substring(0, 55)}`);
            continue;
        }
        const result = await analyzeDish(dishName);
        if (result) {
            if (result.isValidDish === false) {
                console.log(`  ⚠️  "${dishName}" flagged as theme header by AI — skipping`);
                continue;
            }
            if (!hasOrigin) {
                origins[dishName] = result.origin;
                originsUpdated = true;
            }
            if (!hasDescription) {
                descriptions[dishName] = result.description;
                descriptionsUpdated = true;
            }
            analyzed++;
            console.log(`  🌍 ${result.origin.country} — "${result.description.en.substring(0, 50)}" — ${dishName.substring(0, 40)}`);
        } else {
            analysisFailed++;
            console.log(`  ✗ failed: ${dishName}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (originsUpdated) fs.writeFileSync(ORIGINS_PATH, JSON.stringify(origins, null, 2));
    if (descriptionsUpdated) fs.writeFileSync(DESCRIPTIONS_PATH, JSON.stringify(descriptions, null, 2));
    if (originsUpdated || descriptionsUpdated) console.log('  💾 Saved');
    if (analyzed > 0 || analysisFailed > 0) {
        console.log(`  📊 Analyzed: ${analyzed} new, ${analysisFailed} failed, ${allDishNames.size - analyzed - analysisFailed} cached`);
    } else {
        console.log('  ✓ All dishes already cached');
    }

    // Final summary
    console.log('\n' + '═'.repeat(60));
    console.log('🏁 UPDATE COMPLETE');
    console.log('═'.repeat(60));
    console.log(`   Canteens: ${Object.keys(newMenu.canteens).length}`);
    console.log(`   Dishes:   ${allDishNames.size}`);
    if (analysisFailed > 0) {
        console.log(`   ⚠️  Failures: ${analysisFailed} dish analyses`);
    }
    console.log('═'.repeat(60));
}

main().catch(console.error);
