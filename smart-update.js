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

const MENU_PATH = path.join(__dirname, 'public', 'menu.json');
const IMAGES_DIR = path.join(__dirname, 'public', 'images');
const IMAGES_NOBG_DIR = path.join(__dirname, 'public', 'images_nobg');
const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const ORIGINS_PATH = path.join(__dirname, 'public', 'dish-origins.json');
const DESCRIPTIONS_PATH = path.join(__dirname, 'public', 'dish-descriptions.json');

/**
 * Extract main dish names per day for a canteen.
 * Returns { monday: "Chicken jalfrezi...", tuesday: "Cod with...", ... }
 */
function getMainDishes(canteenData) {
    const dishes = {};
    for (const day of DAY_ORDER) {
        const entry = canteenData.menu.find(d => d.day.toLowerCase() === day);
        const items = entry?.en?.items || entry?.no?.items || [];
        const main = items.find(i => i.isMain);
        dishes[day] = main?.dish || null;
    }
    return dishes;
}

/**
 * Compare old and new menus. Returns list of canteens + days that need regeneration.
 */
function findChanges(oldMenu, newMenu) {
    const changes = []; // { canteenName, day, oldDish, newDish }

    for (const [canteenName, newCanteen] of Object.entries(newMenu.canteens)) {
        const oldCanteen = oldMenu?.canteens?.[canteenName];

        if (!oldCanteen) {
            // Entirely new canteen — regenerate all days
            for (const day of DAY_ORDER) {
                const entry = newCanteen.menu.find(d => d.day.toLowerCase() === day);
                const items = entry?.en?.items || [];
                const main = items.find(i => i.isMain);
                if (main) {
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

        for (const day of DAY_ORDER) {
            const oldDish = oldDishes[day];
            const newDish = newDishes[day];

            if (!newDish) continue;

            // Regenerate if: dish changed, week changed, or image doesn't exist
            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const imagePath = path.join(IMAGES_NOBG_DIR, day, `${slug}.png`);
            const imageExists = fs.existsSync(imagePath);

            if (oldDish !== newDish || weekChanged || !imageExists) {
                changes.push({ canteenName, day, oldDish, newDish, reason: !imageExists ? 'missing image' : weekChanged ? `week: ${oldWeek} → ${newWeek}` : 'dish changed' });
            }
        }
    }

    return changes;
}

// Path to master plate reference image for consistent plate style across all generations
const MASTER_PLATE_REF_PATH = path.join(__dirname, 'public', 'images', 'master-plate-ref.png');

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
        const response = await ai.models.generateContent({
            model: 'gemini-3.1-flash-image-preview',
            contents: { parts },
            config: { responseModalities: ['Text', 'Image'], imageConfig: { imageSize: '512px' } },
        });

        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                const sharp = require('sharp');
                const raw = Buffer.from(part.inlineData.data, 'base64');
                const pngBuffer = await sharp(raw).png().toBuffer();
                const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
                const dayDir = path.join(IMAGES_DIR, day);
                if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
                fs.writeFileSync(path.join(dayDir, `${slug}.png`), pngBuffer);
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

        // Flood fill from edges
        const visited = new Uint8Array(totalPixels);
        const isBg = new Uint8Array(totalPixels);
        const queue = [];

        for (let x = 0; x < width; x++) { queue.push(x); queue.push((height - 1) * width + x); }
        for (let y = 1; y < height - 1; y++) { queue.push(y * width); queue.push(y * width + width - 1); }

        while (queue.length > 0) {
            const idx = queue.shift();
            if (idx < 0 || idx >= totalPixels || visited[idx]) continue;
            visited[idx] = 1;
            const pi = idx * channels;
            const r = data[pi], g = data[pi + 1], b = data[pi + 2];
            const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
            const brightness = (r + g + b) / 3;
            if (!(maxDiff < 50 && brightness <= 185)) continue;
            isBg[idx] = 1;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0) queue.push(idx - 1);
            if (x < width - 1) queue.push(idx + 1);
            if (y > 0) queue.push(idx - width);
            if (y < height - 1) queue.push(idx + width);
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

        // Apply transparency
        for (let i = 0; i < totalPixels; i++) {
            if (isBg[i]) data[i * channels + 3] = 0;
        }

        // Standardize plate size: trim transparency, scale precisely, and compose onto 512x512 canvas
        const trimmedBuffer = await sharp(data, { raw: { width, height, channels } })
            .trim()
            .resize(440, 440, { fit: 'inside' })
            .png()
            .toBuffer();

        await sharp({
            create: {
                width: 512,
                height: 512,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
        })
        .composite([{ input: trimmedBuffer, gravity: 'center' }])
        .png({ compressionLevel: 9, palette: true })
        .toFile(outputPath);

        return true;
    } catch (error) {
        console.error(`  ❌ BG removal failed: ${error.message}`);
        return false;
    }
}

/**
 * Detect the country of origin for a dish using Gemini text generation.
 * Returns { country, code } or null on failure.
 */
async function detectDishOrigin(dishName) {
    const { GoogleGenAI } = require('@google/genai');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return null;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const promptText = `You are a food history expert. Identify the single country this dish most likely originated from. Always provide a best guess — never refuse, even for generic dishes. Use ingredients, cooking style, or cultural context as clues. If truly uncertain, pick the most plausible country. Dish: "${dishName}". Respond ONLY with raw JSON, no explanation: {"country":"Italy","code":"it"} where "code" is the ISO 3166-1 alpha-2 country code in lowercase.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: promptText }] },
            config: { responseMimeType: 'application/json' },
        });
        const text = response.candidates[0].content.parts[0].text;
        const parsed = JSON.parse(text);
        if (parsed.country && parsed.code) return parsed;
        return null;
    } catch (error) {
        console.error(`  ❌ Origin detection failed for "${dishName}": ${error.message}`);
        return null;
    }
}

/**
 * Generate a short, appetizing one-line description of a dish in both EN and NO using Gemini.
 * Returns { en: "...", no: "..." } or null on failure.
 */
async function generateDishDescription(dishName) {
    const { GoogleGenAI } = require('@google/genai');
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) return null;
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const promptText = `Write a single short appetizing description (max 20 words) for this dish: "${dishName}". Be warm and inviting, mention a key flavor or texture. Provide it in both English and Norwegian. Respond ONLY with raw JSON: {"en":"English description","no":"Norwegian description"}`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ text: promptText }] },
            config: { responseMimeType: 'application/json' },
        });
        const text = response.candidates[0].content.parts[0].text.trim();
        const parsed = JSON.parse(text);
        if (parsed.en && parsed.no) return parsed;
        return null;
    } catch (error) {
        console.error(`  ❌ Description generation failed for "${dishName}": ${error.message}`);
        return null;
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

    const newMenu = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
    console.log(`\n📋 New menu: scraped ${newMenu.scrapedAt}`);
    for (const [name, data] of Object.entries(newMenu.canteens)) {
        console.log(`   ${name}: ${data.week}`);
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

    // Step 5: Detect origins for all dishes in the new menu
    console.log('\n🌍 Checking dish origins...');
    const allDishNames = new Set();
    for (const canteen of Object.values(newMenu.canteens)) {
        for (const dayEntry of canteen.menu) {
            const enItems = dayEntry?.en?.items || [];
            const main = enItems.find(i => i.isMain);
            if (main?.dish) allDishNames.add(main.dish);
        }
    }

    let originsUpdated = false;
    for (const dishName of allDishNames) {
        if (origins[dishName]) {
            console.log(`  ✓ cached: ${dishName}`);
            continue;
        }
        const result = await detectDishOrigin(dishName);
        if (result) {
            origins[dishName] = result;
            originsUpdated = true;
            console.log(`  🌍 ${result.country} (${result.code}) — ${dishName}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (originsUpdated) {
        fs.writeFileSync(ORIGINS_PATH, JSON.stringify(origins, null, 2));
        console.log('  💾 Origins saved');
    } else {
        console.log('  ✓ All origins already cached');
    }

    // Step 6: Generate short descriptions for all dishes
    console.log('\n📝 Checking dish descriptions...');
    let descriptionsUpdated = false;
    for (const dishName of allDishNames) {
        if (descriptions[dishName]) {
            console.log(`  ✓ cached: ${dishName.substring(0, 50)}`);
            continue;
        }
        const desc = await generateDishDescription(dishName);
        if (desc) {
            descriptions[dishName] = desc;
            descriptionsUpdated = true;
            console.log(`  📝 "${desc.substring(0, 60)}" — ${dishName.substring(0, 40)}`);
        }
        await new Promise(r => setTimeout(r, 500));
    }

    if (descriptionsUpdated) {
        fs.writeFileSync(DESCRIPTIONS_PATH, JSON.stringify(descriptions, null, 2));
        console.log('  💾 Descriptions saved');
    } else {
        console.log('  ✓ All descriptions already cached');
    }
}

main().catch(console.error);
