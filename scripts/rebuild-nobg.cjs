#!/usr/bin/env node
/**
 * Rebuild all images_nobg/* PNGs from the high-quality images/* sources.
 * One-off: existing no-bg files were saved as PNG-8 palette (banded color).
 * Re-runs the bg-removal pipeline in full RGB so cards no longer look washed out.
 */

// To run locally: `node --env-file=.env.local scripts/rebuild-nobg.cjs`
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const IMAGE_SIZE_PX = 1024;
const PLATE_RESIZE_PX = 880;
const SKIP_PREFIXES = ['archive/', 'closed-plates/'];
const SKIP_FILES = new Set(['master-plate-ref.png']);

async function removeBg(inputBuffer) {
    const { data, info } = await sharp(inputBuffer).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
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
        if (x > 0) enqueue(idx - 1);
        if (x < width - 1) enqueue(idx + 1);
        if (y > 0) enqueue(idx - width);
        if (y < height - 1) enqueue(idx + width);
    }

    for (let i = 0; i < totalPixels; i++) if (isBg[i]) data[i * channels + 3] = 0;

    const padTop = Math.floor((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2);
    const padBot = Math.ceil((IMAGE_SIZE_PX - PLATE_RESIZE_PX) / 2);

    return await sharp(data, { raw: { width, height, channels } })
        .trim()
        .resize(PLATE_RESIZE_PX, PLATE_RESIZE_PX, { fit: 'inside' })
        .extend({
            top: padTop, bottom: padBot, left: padTop, right: padBot,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png({ compressionLevel: 9 })
        .toBuffer();
}

async function listAllImages() {
    const out = [];
    const queue = ['']; // BFS through subdirs
    while (queue.length) {
        const prefix = queue.shift();
        const { data, error } = await supabase.storage.from('images').list(prefix, { limit: 1000 });
        if (error) throw error;
        for (const entry of data) {
            const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const isFolder = !entry.id; // folders have null id in supabase storage
            if (isFolder) {
                if (SKIP_PREFIXES.some(p => fullPath.startsWith(p.replace(/\/$/, '')))) continue;
                queue.push(fullPath);
            } else {
                if (SKIP_FILES.has(entry.name)) continue;
                if (!entry.name.endsWith('.png')) continue;
                out.push(fullPath);
            }
        }
    }
    return out;
}

async function main() {
    console.log('🔍 Listing images/* in Supabase…');
    const paths = await listAllImages();
    console.log(`Found ${paths.length} source images.\n`);

    let ok = 0, skip = 0, fail = 0;
    for (const p of paths) {
        try {
            const { data: blob, error } = await supabase.storage.from('images').download(p);
            if (error) throw error;
            const inputBuffer = Buffer.from(await blob.arrayBuffer());
            const meta = await sharp(inputBuffer).metadata();
            // Skip already-transparent inputs (e.g., a mistaken upload)
            if (meta.channels === 4) {
                console.log(`  ↩︎  ${p} already has alpha, skipping`);
                skip++;
                continue;
            }
            const out = await removeBg(inputBuffer);
            const { error: upErr } = await supabase.storage
                .from('images_nobg')
                .upload(p, out, { contentType: 'image/png', upsert: true });
            if (upErr) throw upErr;
            console.log(`  ✅ ${p}  (${(out.length / 1024).toFixed(0)} kB)`);
            ok++;
        } catch (err) {
            console.error(`  ❌ ${p}: ${err.message}`);
            fail++;
        }
    }

    console.log(`\n🏁 Rebuilt: ${ok} ok, ${skip} skipped, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
