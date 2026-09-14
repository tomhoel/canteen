#!/usr/bin/env node
/**
 * Re-encode the stored plate archive from PNG to WebP, in place.
 *
 * Nothing ever fetches these objects directly — every display path goes through
 * Supabase's /render/image/ transform, which re-encodes to WebP at 340, 640 or
 * 1080 px. So each 1.6 MB PNG master existed only to be re-encoded down to
 * ~24 KB. Across 335 objects that is 556 MB to serve bytes nobody receives.
 *
 * Dimensions are NOT changed. The masters are 1024² and the lightbox asks for
 * 1080, so they are already the smallest size that serves every variant at
 * native resolution. Only the encoding changes.
 *
 * Object keys are NOT changed either. 319 dish_cache.image_nobg_path rows end
 * in `.png` and the server resolves them verbatim; renaming would blank every
 * card for hours while cached responses pointed at objects that no longer
 * exist. The bytes inside become WebP and the contentType metadata says so.
 * This script never touches the database.
 *
 * Idempotent and resumable: anything already WebP, already small, or that would
 * grow is skipped, so a crashed run costs one list call to pick back up.
 *
 *   node --env-file=.env scripts/shrink-archive.cjs --dry-run
 *   node --env-file=.env scripts/shrink-archive.cjs --bucket images
 *   node --env-file=.env scripts/shrink-archive.cjs
 */

const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
});

const DRY_RUN = process.argv.includes('--dry-run');
const bucketArg = process.argv.indexOf('--bucket');
const BUCKET = bucketArg !== -1 ? process.argv[bucketArg + 1] : 'images_nobg';
const PREFIX = 'archive';

/** Below this, re-encoding is not worth a round trip — and it is already done. */
const MIN_SIZE_BYTES = 400_000;

const WEBP = { quality: 90, alphaQuality: 100, effort: 4 };

async function listAll(prefix) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase.storage
            .from(BUCKET)
            .list(prefix, { limit: 1000, offset });
        if (error) throw new Error(`list ${prefix}: ${error.message}`);
        if (!data || data.length === 0) break;
        out.push(...data);
        if (data.length < 1000) break;
    }
    return out.filter((o) => o.metadata && o.metadata.size);
}

async function main() {
    console.log(`${DRY_RUN ? '🔍 DRY RUN — ' : ''}re-encoding ${BUCKET}/${PREFIX}/ to WebP q${WEBP.quality}\n`);

    const objects = await listAll(PREFIX);
    console.log(`  ${objects.length} objects listed\n`);

    let done = 0, skipped = 0, failed = 0, bytesIn = 0, bytesOut = 0;

    for (const obj of objects) {
        const path = `${PREFIX}/${obj.name}`;
        const size = obj.metadata.size;

        if (obj.metadata.mimetype === 'image/webp') { skipped++; continue; }
        if (size < MIN_SIZE_BYTES) { skipped++; continue; }

        try {
            const { data: blob, error } = await supabase.storage.from(BUCKET).download(path);
            if (error) throw new Error(error.message);
            const input = Buffer.from(await blob.arrayBuffer());

            // A plate without an alpha channel would composite as a solid
            // rectangle on the card's warm gradient. Skip rather than bake that in.
            const meta = await sharp(input).metadata();
            if (!meta.hasAlpha) {
                console.warn(`  ⚠️  no alpha, skipping: ${obj.name}`);
                skipped++;
                continue;
            }

            const output = await sharp(input).webp(WEBP).toBuffer();
            if (output.length >= input.length) {
                console.warn(`  ⚠️  would grow, skipping: ${obj.name}`);
                skipped++;
                continue;
            }

            bytesIn += input.length;
            bytesOut += output.length;

            if (!DRY_RUN) {
                const { error: upErr } = await supabase.storage
                    .from(BUCKET)
                    .upload(path, output, { contentType: 'image/webp', upsert: true });
                if (upErr) throw new Error(upErr.message);
            }

            done++;
            const pct = ((100 * output.length) / input.length).toFixed(1);
            console.log(
                `  ${String(done).padStart(3)}. ${(input.length / 1024).toFixed(0).padStart(5)} kB → ` +
                `${(output.length / 1024).toFixed(0).padStart(4)} kB (${pct.padStart(4)}%)  ${obj.name}`
            );
        } catch (err) {
            failed++;
            console.error(`  ❌ ${obj.name}: ${err.message}`);
        }
    }

    const mb = (b) => (b / 1024 / 1024).toFixed(1);
    console.log(`\n  ${DRY_RUN ? 'would re-encode' : 're-encoded'}: ${done}   skipped: ${skipped}   failed: ${failed}`);
    if (bytesIn) {
        console.log(`  ${mb(bytesIn)} MB → ${mb(bytesOut)} MB  (${((100 * bytesOut) / bytesIn).toFixed(1)}%)`);
    }
    if (failed) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
