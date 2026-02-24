const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const IMAGES_NOBG_DIR = path.join(__dirname, 'public', 'images_nobg');
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

async function standardizeImage(inputPath, outputPath) {
    try {
        console.log(`Processing: ${inputPath}`);
        
        // Trim transparent pixels and resize the non-transparent part (the plate) to exactly 440x440
        const trimmedBuffer = await sharp(inputPath)
            .trim() 
            .resize(440, 440, { fit: 'inside' })
            .toBuffer();

        // Place the standardized plate onto a 512x512 transparent canvas
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

        console.log(`  ✅ Standardized: ${outputPath}`);
    } catch (err) {
        console.error(`  ❌ Failed: ${err.message}`);
    }
}

async function main() {
    for (const day of DAYS) {
        const dayDir = path.join(IMAGES_NOBG_DIR, day);
        if (!fs.existsSync(dayDir)) continue;

        const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.png'));
        for (const file of files) {
            const filePath = path.join(dayDir, file);
            // Process the image in place (or you can write to a tmp file and replace)
            const tmpPath = filePath + '.tmp.png';
            await standardizeImage(filePath, tmpPath);
            if (fs.existsSync(tmpPath)) {
                fs.renameSync(tmpPath, filePath);
            }
        }
    }
    console.log("All existing images have been standardized.");
}

main();
