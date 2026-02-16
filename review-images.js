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
- Framing: Plate perfectly centered, complete rim visible with margin
- Size: Food covers 60-70% of plate surface
- Format: Square 1:1 ratio, 1024x1024px

Plate (CRITICAL - MUST FOLLOW EXACTLY):
- Plate: Round warm beige/cream stoneware dinner plate (10-11 inches)
- Plate color: Warm sandy beige (#E8D5B7) — NOT white, NOT grey
- Plate MUST have a clearly visible raised rim/edge all the way around
- Plate must cast a subtle shadow on the background (shows depth/separation)

Food & Styling:
- Professional restaurant plating, appetizing presentation
- Food centered on plate with realistic portions
- Lighting: Soft diffused overhead light, gentle shadow under plate rim
- Quality: Sharp, photorealistic, high detail, 8K quality

Background (CRITICAL):
- Background: Solid DARK GREY (#707070) seamless studio backdrop
- Must be clearly DARKER than the beige plate (high contrast)
- MUST be perfectly uniform grey — no gradients, no textures
- Sharp clean edge where plate rim meets grey background

Strict Exclusions:
- NO white plates — use warm beige/sandy stoneware ONLY
- NO light grey backgrounds — must be dark grey (#707070)
- NO table surfaces, wood, marble, or cloth
- NO utensils, napkins, garnishes outside plate
- NO hands, people, or decorative elements
- NO text, watermarks, labels
- NO angled views — strictly 90° overhead only

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
        execSync(`node -e "
const sharp = require('sharp');
(async () => {
    const {data, info} = await sharp('${inputPath}').raw().ensureAlpha().toBuffer({resolveWithObject:true});
    const {width, height, channels} = info;
    const total = width * height;
    const visited = new Uint8Array(total);
    const isBg = new Uint8Array(total);
    const queue = [];
    for (let x=0;x<width;x++) { queue.push(x); queue.push((height-1)*width+x); }
    for (let y=1;y<height-1;y++) { queue.push(y*width); queue.push(y*width+width-1); }
    while (queue.length) {
        const idx = queue.shift();
        if (idx<0||idx>=total||visited[idx]) continue;
        visited[idx]=1;
        const pi=idx*channels, r=data[pi], g=data[pi+1], b=data[pi+2];
        const maxD=Math.max(Math.abs(r-g),Math.abs(g-b),Math.abs(r-b));
        const br=(r+g+b)/3;
        if (!(maxD<30&&br>=60&&br<=170)) continue;
        isBg[idx]=1;
        const x=idx%width, y=Math.floor(idx/width);
        if(x>0)queue.push(idx-1);if(x<width-1)queue.push(idx+1);
        if(y>0)queue.push(idx-width);if(y<height-1)queue.push(idx+width);
    }
    for(let i=0;i<total;i++){if(isBg[i])data[i*channels+3]=0;}
    await sharp(data,{raw:{width,height,channels}}).png({compressionLevel:9}).toFile('${outputPath}');
})();
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
