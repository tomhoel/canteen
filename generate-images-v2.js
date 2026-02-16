#!/usr/bin/env node
/**
 * VERSION 2: Shows full plates with food, consistent 45° angle
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) { console.error('❌ GEMINI_API_KEY environment variable required'); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

// IMPROVED PROMPT - Top-down overhead shot, full plate visible
const GENERATION_PROMPT = (dishName, canteenName) =>
`Professional food photography of "${dishName}", top-down overhead shot on a clean white ceramic plate, soft natural lighting, shallow depth of field, restaurant quality presentation, minimalist Scandinavian style, no text or labels, photorealistic.

CRITICAL REQUIREMENTS:
- Camera: Top-down overhead shot looking straight down at the plate
- MUST SHOW: Complete round plate fully visible with generous margin around all edges
- Plate color: Clean white or light ceramic plate
- Food positioning: Centered on plate, realistic portions
- Background: Solid light gray (#E8E8E8) seamless backdrop
- Lighting: Natural soft lighting, subtle shadows
- NO cropped plates, NO angled shots, entire rim must be visible
- Style: Restaurant menu photography, appetizing and realistic`;

async function generateImage(dishName, canteenName) {
    const prompt = GENERATION_PROMPT(dishName, canteenName);
    console.log(`  📸 Generating: ${dishName.substring(0, 45)}...`);
    
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
        console.error(`  ❌ Failed: ${error.message}`);
        return null;
    }
}

async function main() {
    const menuData = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'menu.json'), 'utf8'));
    const imagesDir = path.join(__dirname, 'public', 'images');
    
    console.log('🎨 GENERATING IMAGES - VERSION 2');
    console.log('Features: 45° angle + visible plates + light gray bg');
    console.log('=' .repeat(55));
    
    for (const day of DAY_ORDER) {
        const dayDir = path.join(imagesDir, day);
        if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });

        console.log(`\n📅 ${day.toUpperCase()}`);

        for (const [canteenName, canteen] of Object.entries(menuData.canteens)) {
            const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === day);
            if (!dayEntry) continue;

            const items = dayEntry.en?.items || dayEntry.no?.items;
            if (!items) continue;

            const mainDish = items.find(i => i.isMain);
            if (!mainDish) continue;

            const filename = canteenName.toLowerCase().replace(/\s+/g, '_') + '.png';
            const filepath = path.join(dayDir, filename);

            const buffer = await generateImage(mainDish.dish, canteenName);
            
            if (buffer) {
                fs.writeFileSync(filepath, buffer);
                console.log(`  ✅ ${canteenName}: ${Math.round(buffer.length/1024)}KB`);
            } else {
                console.log(`  ❌ ${canteenName}: FAILED`);
            }

            await new Promise(r => setTimeout(r, 1500));
        }
    }

    console.log('\n' + '='.repeat(55));
    console.log('🎉 Generation complete!');
    console.log('Next: Run remove-bg.py to remove gray backgrounds');
}

main().catch(console.error);
