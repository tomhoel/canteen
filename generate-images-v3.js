#!/usr/bin/env node
/**
 * V3: OVERHEAD VIEW + TRANSPARENT BACKGROUND
 * Most consistent approach - eliminates angle variation
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY required'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/**
 * OVERHEAD VIEW STRATEGY:
 * - 90° top-down = most consistent angle across all AI generations
 * - Transparent background = no post-processing needed
 * - White plate with full rim visible = clean, professional look
 */
const OVERHEAD_TRANSPARENT_PROMPT = (dishName) =>
`Professional overhead food photography of "${dishName}".

STRICT TECHNICAL SPECIFICATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Camera & Composition:
- Angle: Overhead shot, camera at 90° directly above plate
- Framing: Plate perfectly centered, complete rim visible
- Size: Food covers 60-70% of plate surface (realistic portion)
- Format: Square 1:1 ratio, 1024x1024px

Plate & Styling:
- Plate: Round white ceramic dinner plate (10-11 inches)
- Plating: Professional restaurant presentation
- Lighting: Soft diffused overhead light, minimal shadows
- Quality: Sharp, photorealistic, high detail

Background & Format:
- Background: COMPLETELY TRANSPARENT (alpha channel/no background)
- Output: PNG with transparency
- ONLY visible elements: white plate + food

Strict Exclusions:
- NO table surface or texture visible
- NO utensils, napkins, garnishes outside plate
- NO hands, people, or decorative elements
- NO text, watermarks, labels
- NO angled views or perspective

Style: Minimalist Scandinavian food photography, clean and professional.`;

/**
 * GREY BACKGROUND FALLBACK (if transparent doesn't work well)
 */
const OVERHEAD_GREY_PROMPT = (dishName) =>
`Professional overhead food photography of "${dishName}".

STRICT TECHNICAL SPECIFICATIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Camera & Composition:
- Angle: Overhead shot, camera at 90° directly above plate
- Framing: Plate perfectly centered, complete rim visible
- Size: Food covers 60-70% of plate surface
- Format: Square 1:1 ratio, 1024x1024px

Plate & Styling:
- Plate: Round BEIGE/CREAM ceramic dinner plate (warm off-white color #F5E6D3)
- CRITICAL: Plate MUST be beige/cream colored, NOT pure white
- Plating: Professional restaurant presentation
- Lighting: Soft diffused overhead light, minimal shadows
- Quality: Sharp, photorealistic, high detail

Background:
- Background: Solid neutral grey (#C0C0C0) seamless backdrop
- MUST be uniform grey color (no gradients, textures, shadows)
- ONLY visible elements: grey background + beige/cream plate + food

Strict Exclusions:
- NO white plates (use beige/cream only)
- NO table surface or wood grain
- NO utensils, napkins, garnishes outside plate
- NO hands, people, or decorative elements
- NO text, watermarks, labels
- NO angled views or perspective

Style: Minimalist Scandinavian food photography, clean and professional.`;

async function generateImage(dishName, canteenName, style = 'transparent') {
    const prompt = style === 'grey'
        ? OVERHEAD_GREY_PROMPT(dishName)
        : OVERHEAD_TRANSPARENT_PROMPT(dishName);

    const displayName = dishName.substring(0, 45);
    console.log(`  📸 ${canteenName}: ${displayName}...`);

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
                return Buffer.from(part.inlineData.data, 'base64');
            }
        }
        return null;
    } catch (error) {
        console.error(`  ❌ Error: ${error.message}`);
        return null;
    }
}

async function main() {
    const args = process.argv.slice(2);
    const style = args.includes('--grey') ? 'grey' : 'transparent';
    const forceRegen = args.includes('--force');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  IMAGE GENERATION V3 - OVERHEAD VIEW APPROACH           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\n📐 View: Overhead (90° top-down)`);
    console.log(`🎨 Background: ${style === 'grey' ? 'Grey (remove later)' : 'Transparent (direct)'}`);
    console.log(`🔄 Force regenerate: ${forceRegen ? 'YES' : 'NO'}\n`);
    console.log('═'.repeat(60));

    const menuData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'menu.json'), 'utf8'));
    const imagesDir = path.join(__dirname, 'public', 'images');

    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const day of DAY_ORDER) {
        const dayDir = path.join(imagesDir, day);
        if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

        console.log(`\n📅 ${day.toUpperCase()}`);
        console.log('─'.repeat(60));

        for (const [canteenName, canteen] of Object.entries(menuData.canteens)) {
            const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === day);
            if (!dayEntry) continue;

            const items = dayEntry.en?.items || dayEntry.no?.items;
            if (!items) continue;

            const mainDish = items.find(i => i.isMain);
            if (!mainDish) continue;

            const filename = canteenName.toLowerCase().replace(/\s+/g, '_') + '.png';
            const filepath = path.join(dayDir, filename);

            if (fs.existsSync(filepath) && !forceRegen) {
                console.log(`  ⏭️  ${canteenName}: Already exists (use --force to regenerate)`);
                skipped++;
                continue;
            }

            const buffer = await generateImage(mainDish.dish, canteenName, style);

            if (buffer) {
                fs.writeFileSync(filepath, buffer);
                const sizeKB = Math.round(buffer.length / 1024);
                console.log(`  ✅ ${canteenName}: Saved (${sizeKB}KB)`);
                generated++;
            } else {
                console.log(`  ❌ ${canteenName}: Failed to generate`);
                failed++;
            }

            // Rate limiting (avoid API throttling)
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('📊 GENERATION SUMMARY');
    console.log('═'.repeat(60));
    console.log(`✅ Generated:  ${generated} images`);
    console.log(`⏭️  Skipped:    ${skipped} images`);
    console.log(`❌ Failed:     ${failed} images`);
    console.log('═'.repeat(60));

    if (style === 'grey') {
        console.log('\n💡 NEXT STEP:');
        console.log('   Run: node remove-grey-bg.js');
        console.log('   To remove grey backgrounds and create transparent versions');
    } else {
        console.log('\n✨ Images should already have transparent backgrounds');
        console.log('   Location: public/images/[day]/[canteen].png');
        console.log('\n💡 TIP: If backgrounds aren\'t transparent, regenerate with:');
        console.log('   node generate-images-v3.js --grey --force');
    }
}

main().catch(console.error);
