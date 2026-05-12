#!/usr/bin/env node
/**
 * One-time uploader for the closed-canteen plate designs.
 *
 * Puts public/images/closed-plates/closed-plate-{1,2,3}.png into Supabase
 * at images_nobg/closed-plates/closed-plate-{1,2,3}.png so the Vercel
 * frontend can reference them directly via getClosedPlateUrl().
 *
 * Re-run whenever the source PNGs change. Uses upsert, so it's safe to run
 * repeatedly.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/upload-closed-plates.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 0 } },
});

async function uploadOne(variant) {
    const filename = `closed-plate-${variant}.png`;
    const src = path.join(__dirname, '..', 'public', 'images', 'closed-plates', filename);
    if (!fs.existsSync(src)) {
        console.log(`  ⚠️  ${filename} not in repo, skipping`);
        return;
    }
    const buffer = fs.readFileSync(src);
    const { error } = await supabase.storage
        .from('images_nobg')
        .upload(`closed-plates/${filename}`, buffer, {
            contentType: 'image/png',
            upsert: true,
        });
    if (error) console.error(`  ❌ ${filename}: ${error.message}`);
    else console.log(`  ✅ images_nobg/closed-plates/${filename}`);
}

(async () => {
    console.log('Uploading closed-plate variants to Supabase...');
    for (const v of [1, 2, 3]) await uploadOne(v);
    console.log('Done.');
})();
