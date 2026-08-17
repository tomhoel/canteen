#!/usr/bin/env node
/**
 * One-time uploader for the master plate reference.
 *
 * Puts public/images/master-plate-ref.png into Supabase at
 * images/reference/master-plate-ref.png, where image.service.ts fetches it
 * before every generation run.
 *
 * It has to live in storage rather than being read off disk: plate generation
 * runs inside the Vercel cron function, and public/ is not part of that
 * function's bundle. The pre-migration generator read it with fs.existsSync
 * from the repo root, which worked only because it ran as a GitHub Action.
 *
 * Re-run whenever the source PNG changes. Uses upsert, so it is safe to run
 * repeatedly.
 *
 *   node --env-file-if-exists=.env scripts/upload-master-plate.cjs
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

const SRC = path.join(__dirname, '..', 'public', 'images', 'master-plate-ref.png');
const BUCKET = 'images';
const DEST = 'reference/master-plate-ref.png';

async function main() {
    if (!fs.existsSync(SRC)) {
        console.error(`Source not found: ${SRC}`);
        process.exit(1);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
    });

    const body = fs.readFileSync(SRC);
    const { error } = await supabase.storage.from(BUCKET).upload(DEST, body, {
        contentType: 'image/png',
        upsert: true,
    });

    if (error) {
        console.error(`Upload failed: ${error.message}`);
        process.exit(1);
    }

    console.log(`✅ ${BUCKET}/${DEST} (${(body.length / 1024).toFixed(0)} KB)`);
}

main();
