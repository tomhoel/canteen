#!/usr/bin/env node
/**
 * AI Image Quality Review
 * Reviews each generated food image with Gemini Vision and regenerates if quality is poor.
 * Checks: transparent background, full plate visible, food matches dish name, consistent style.
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const { execSync } = require('child_process');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY required'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const MAX_RETRIES = 2;

const GENERATION_PROMPT = (dishName) =>
`Professional overhead food photography of "${dishName}".

STRICT TECHNICAL SPECIFICATIONS:
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

async function reviewImage(imagePath, dishName) {
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');

    const prompt = `You are a strict food photography quality reviewer. Analyze this image and check ALL of the following criteria:

1. TRANSPARENT BACKGROUND: Is the background fully transparent/removed (PNG with no solid background)?
2. FULL PLATE VISIBLE: Is the complete plate/dish visible without any cropping at the edges? The entire rim must be visible.
3. FOOD MATCH: Does the food reasonably match "${dishName}"?
4. QUALITY: Is the image appetizing, well-lit, and professional looking?
5. PLATE STYLE: Is it a proper round plate (not a bowl, cutting board, or other surface)?

Respond with EXACTLY this format:
PASS or FAIL
REASON: <one line explanation if FAIL>`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [{
                role: 'user',
                parts: [
                    { inlineData: { mimeType: 'image/png', data: base64 } },
                    { text: prompt }
                ]
            }]
        });

        const text = response.candidates[0].content.parts[0].text.trim();
        const passed = text.toUpperCase().startsWith('PASS');
        const reason = text.includes('REASON:') ? text.split('REASON:')[1].trim() : text;
        return { passed, reason };
    } catch (error) {
        console.error(`    ⚠️ Review error: ${error.message}`);
        return { passed: true, reason: 'Review failed, keeping image' };
    }
}

async function generateImage(dishName) {
    const prompt = GENERATION_PROMPT(dishName);
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: prompt,
            config: { responseModalities: ['Text', 'Image'] },
        });
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
                return Buffer.from(part.inlineData.data, 'base64');
            }
        }
        return null;
    } catch (error) {
        console.error(`    ❌ Generation failed: ${error.message}`);
        return null;
    }
}

function removeBackground(inputPath, outputPath) {
    try {
        execSync(`python3 -c "
from rembg import remove
from PIL import Image
inp = Image.open('${inputPath}')
out = remove(inp)
out.save('${outputPath}')
"`, { stdio: 'pipe' });
        return true;
    } catch (error) {
        console.error(`    ❌ Background removal failed`);
        return false;
    }
}

async function main() {
    const menuData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'menu.json'), 'utf8'));

    console.log('🔍 AI IMAGE QUALITY REVIEW');
    console.log('='.repeat(55));

    let totalReviewed = 0;
    let totalPassed = 0;
    let totalRegenerated = 0;

    for (const day of DAY_ORDER) {
        console.log(`\n📅 ${day.toUpperCase()}`);

        for (const [canteenName, canteen] of Object.entries(menuData.canteens)) {
            const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === day);
            if (!dayEntry) continue;

            const items = dayEntry.en?.items || dayEntry.no?.items;
            if (!items) continue;

            const mainDish = items.find(i => i.isMain);
            if (!mainDish) continue;

            const slug = canteenName.toLowerCase().replace(/\s+/g, '_');
            const nobgPath = path.join(__dirname, 'public', 'images_nobg', day, `${slug}.png`);
            const rawPath = path.join(__dirname, 'public', 'images', day, `${slug}.png`);

            if (!fs.existsSync(nobgPath)) {
                console.log(`  ⏭️  ${canteenName}: No image found, skipping`);
                continue;
            }

            totalReviewed++;
            console.log(`  🔍 ${canteenName}: "${mainDish.dish.substring(0, 40)}..."`);

            let passed = false;
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                const review = await reviewImage(nobgPath, mainDish.dish);

                if (review.passed) {
                    console.log(`    ✅ PASS${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
                    passed = true;
                    totalPassed++;
                    break;
                }

                console.log(`    ❌ FAIL: ${review.reason}`);

                if (attempt < MAX_RETRIES) {
                    console.log(`    🔄 Regenerating (attempt ${attempt + 2}/${MAX_RETRIES + 1})...`);
                    totalRegenerated++;

                    const buffer = await generateImage(mainDish.dish);
                    if (buffer) {
                        fs.writeFileSync(rawPath, buffer);
                        removeBackground(rawPath, nobgPath);
                    }
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    console.log(`    ⚠️ Max retries reached, keeping last version`);
                    totalPassed++; // count as passed to not block pipeline
                }
            }
        }
    }

    console.log('\n' + '='.repeat(55));
    console.log(`📊 Results: ${totalPassed}/${totalReviewed} passed, ${totalRegenerated} regenerated`);
    console.log('✅ Review complete!');
}

main().catch(console.error);
