#!/usr/bin/env node
/**
 * Precise Grey Background Remover (Sharp-based)
 * Removes dark grey (#707070) backgrounds while perfectly preserving beige plates + food.
 * Uses flood-fill from edges so only connected background is removed.
 * Smooth alpha blending at plate edges for clean cutouts.
 */

const fs = require('fs');
const path = require('path');

let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.error('❌ Sharp not installed. Run: npm install sharp');
    process.exit(1);
}

/**
 * Check if a pixel is "grey background" (includes plate shadows)
 * Target: dark grey ~#707070 (112,112,112) but AI varies
 * Shadows under plates can be very dark (brightness 20-60) but still balanced grey.
 * Safe to use wide range because flood-fill only removes edge-connected pixels.
 */
function isGreyPixel(r, g, b) {
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    const brightness = (r + g + b) / 3;

    // Conservative grey detection for flood fill (safe, won't eat food):
    // Grey = balanced channels, dark to medium brightness
    return maxDiff < 50 && brightness <= 185;
}

/**
 * Flood-fill from image edges to find connected grey background.
 * This ensures we ONLY remove grey that's connected to the border,
 * never grey-ish pixels inside the food/plate.
 */
function floodFillBackground(data, width, height, channels) {
    const totalPixels = width * height;
    const visited = new Uint8Array(totalPixels);
    const isBackground = new Uint8Array(totalPixels);
    const queue = [];

    // Seed from all edge pixels
    for (let x = 0; x < width; x++) {
        queue.push(x);                              // top row
        queue.push((height - 1) * width + x);       // bottom row
    }
    for (let y = 1; y < height - 1; y++) {
        queue.push(y * width);                       // left column
        queue.push(y * width + (width - 1));         // right column
    }

    // BFS flood fill
    while (queue.length > 0) {
        const idx = queue.shift();
        if (idx < 0 || idx >= totalPixels || visited[idx]) continue;
        visited[idx] = 1;

        const pi = idx * channels;
        const r = data[pi], g = data[pi + 1], b = data[pi + 2];

        if (!isGreyPixel(r, g, b)) continue;

        isBackground[idx] = 1;

        // 4-connected neighbors
        const x = idx % width, y = Math.floor(idx / width);
        if (x > 0) queue.push(idx - 1);
        if (x < width - 1) queue.push(idx + 1);
        if (y > 0) queue.push(idx - width);
        if (y < height - 1) queue.push(idx + width);
    }

    return isBackground;
}

/**
 * Apply smooth alpha at the edges between background and foreground.
 * Creates a feathered transition instead of jagged hard edges.
 */
function applyEdgeSmoothing(data, isBackground, width, height, channels, radius = 2) {
    // First pass: find edge pixels (foreground pixels next to background)
    const edgeDistance = new Float32Array(width * height).fill(999);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            if (isBackground[idx]) {
                edgeDistance[idx] = 0;
                continue;
            }
            // Check if any neighbor is background
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                    const nidx = ny * width + nx;
                    if (isBackground[nidx]) {
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        edgeDistance[idx] = Math.min(edgeDistance[idx], dist);
                    }
                }
            }
        }
    }

    let removedPixels = 0;

    for (let i = 0; i < width * height; i++) {
        const pi = i * channels;
        if (isBackground[i]) {
            // Full transparent
            data[pi + 3] = 0;
            removedPixels++;
        } else if (edgeDistance[i] < radius) {
            // Smooth alpha transition at edges
            const alpha = Math.min(255, Math.round((edgeDistance[i] / radius) * 255));
            data[pi + 3] = alpha;
        }
        // else: fully opaque (untouched)
    }

    return removedPixels;
}

/**
 * After flood-fill, find the largest connected foreground blob (plate+food).
 * Any small disconnected opaque fragments (shadow remnants) get removed.
 */
function keepLargestBlob(isBackground, width, height) {
    const totalPixels = width * height;
    const blobId = new Int32Array(totalPixels).fill(-1);
    const blobSizes = [];
    let currentBlob = 0;

    for (let i = 0; i < totalPixels; i++) {
        if (isBackground[i] || blobId[i] >= 0) continue;

        // BFS to find this connected foreground region
        const queue = [i];
        let size = 0;
        while (queue.length > 0) {
            const idx = queue.pop();
            if (idx < 0 || idx >= totalPixels || isBackground[idx] || blobId[idx] >= 0) continue;
            blobId[idx] = currentBlob;
            size++;
            const x = idx % width, y = Math.floor(idx / width);
            if (x > 0) queue.push(idx - 1);
            if (x < width - 1) queue.push(idx + 1);
            if (y > 0) queue.push(idx - width);
            if (y < height - 1) queue.push(idx + width);
        }
        blobSizes.push(size);
        currentBlob++;
    }

    if (blobSizes.length === 0) return 0;

    // Find the largest blob
    let largestBlob = 0;
    for (let b = 1; b < blobSizes.length; b++) {
        if (blobSizes[b] > blobSizes[largestBlob]) largestBlob = b;
    }

    // Mark all non-largest blobs as background
    let extraRemoved = 0;
    for (let i = 0; i < totalPixels; i++) {
        if (!isBackground[i] && blobId[i] !== largestBlob) {
            isBackground[i] = 1;
            extraRemoved++;
        }
    }

    return extraRemoved;
}

/**
 * Erode dark shadow pixels at the boundary between foreground and background.
 * Iteratively removes dark boundary pixels that look like plate shadows.
 * Runs multiple passes to eat through connected shadow strips.
 */
/**
 * Density-based shadow cleanup.
 * For each remaining opaque pixel, check what fraction of surrounding pixels
 * (in a radius) are transparent. If a dark pixel is mostly surrounded by
 * transparency, it's a shadow remnant — not food.
 * Runs multiple passes since removing shadow pixels exposes new boundary pixels.
 */
function densityShadowCleanup(data, isBackground, width, height, channels) {
    const radius = 12;
    const transparencyThreshold = 0.45; // If >45% of neighbors are transparent
    const brightnessMax = 160; // Only affects dark-ish pixels (shadow, not plate)
    const passes = 5;
    let totalCleaned = 0;

    for (let pass = 0; pass < passes; pass++) {
        const toRemove = [];

        for (let y = radius; y < height - radius; y++) {
            for (let x = radius; x < width - radius; x++) {
                const idx = y * width + x;
                if (isBackground[idx]) continue;

                const pi = idx * channels;
                const brightness = (data[pi] + data[pi + 1] + data[pi + 2]) / 3;
                if (brightness > brightnessMax) continue;

                // Count transparent neighbors in radius
                let transparent = 0, total = 0;
                for (let dy = -radius; dy <= radius; dy += 2) {
                    for (let dx = -radius; dx <= radius; dx += 2) {
                        if (dx * dx + dy * dy > radius * radius) continue;
                        const nidx = (y + dy) * width + (x + dx);
                        total++;
                        if (isBackground[nidx]) transparent++;
                    }
                }

                if (transparent / total > transparencyThreshold) {
                    toRemove.push(idx);
                }
            }
        }

        if (toRemove.length === 0) break;
        for (const idx of toRemove) isBackground[idx] = 1;
        totalCleaned += toRemove.length;
    }

    return totalCleaned;
}

async function removeBackground(inputPath, outputPath) {
    try {
        const image = sharp(inputPath);
        const { data, info } = await image
            .raw()
            .ensureAlpha()
            .toBuffer({ resolveWithObject: true });

        const { width, height, channels } = info;

        // Step 1: Flood fill from edges to find connected grey background
        const isBackground = floodFillBackground(data, width, height, channels);

        // Step 2: Remove shadow remnants using density analysis
        const shadowCleaned = densityShadowCleanup(data, isBackground, width, height, channels);

        // Step 3: Remove small disconnected foreground fragments
        const extraRemoved = keepLargestBlob(isBackground, width, height);

        // Step 4: Apply smooth alpha at edges
        const removedPixels = applyEdgeSmoothing(data, isBackground, width, height, channels, 2);

        // Step 5: Save (resize to 512x512 + compress for fast loading)
        await sharp(data, { raw: { width, height, channels } })
            .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9, palette: true })
            .toFile(outputPath);

        const totalPixels = width * height;
        const allRemoved = removedPixels + extraRemoved + shadowCleaned;
        const percentRemoved = ((allRemoved / totalPixels) * 100).toFixed(1);
        return { success: true, percentRemoved };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function main() {
    const baseDir = path.join(__dirname, 'public', 'images');
    const outputDir = path.join(__dirname, 'public', 'images_nobg');

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  SHARP BACKGROUND REMOVER (Flood-Fill + Edge Smooth)    ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('  Target: dark grey (#707070) background');
    console.log('  Preserve: beige plates + all food\n');

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    let processed = 0, errors = 0;

    for (const day of days) {
        const dayIn = path.join(baseDir, day);
        const dayOut = path.join(outputDir, day);

        if (!fs.existsSync(dayIn)) { console.log(`⏭️  ${day}: no images`); continue; }
        if (!fs.existsSync(dayOut)) fs.mkdirSync(dayOut, { recursive: true });

        console.log(`\n📅 ${day.toUpperCase()}`);
        console.log('─'.repeat(60));

        const files = fs.readdirSync(dayIn).filter(f => f.endsWith('.png'));
        for (const file of files) {
            process.stdout.write(`  🔄 ${file.padEnd(25)} `);
            const result = await removeBackground(path.join(dayIn, file), path.join(dayOut, file));
            if (result.success) {
                console.log(`✅ ${result.percentRemoved}% removed`);
                processed++;
            } else {
                console.log(`❌ ${result.error}`);
                errors++;
            }
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log(`✅ Processed: ${processed} | ❌ Errors: ${errors}`);
    console.log('═'.repeat(60));
}

main().catch(console.error);
