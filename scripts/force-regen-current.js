#!/usr/bin/env node
/**
 * Force-regenerate every current-week dish image using the restored
 * detailed prompt. Bypasses smart-update.js's change-detection so we
 * can repair existing cards that were generated with the gutted
 * one-line prompt (utensils / table surfaces leaking through bg removal).
 *
 * Pulls the menu straight from the live Vercel deployment so we don't
 * need to re-scrape locally.
 */

// To run locally: `node --env-file=.env.local scripts/force-regen-current.js`
// In CI: env vars come from the workflow `env:` block.
const { createClient } = require('@supabase/supabase-js');
const { generateSingleImage, removeBgSingle, getDayItems, isDishClosed, DAY_ORDER } = require('../smart-update.js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    console.log('📡 Fetching latest menu from weekly_menus…');
    const { data, error } = await supabase
        .from('weekly_menus')
        .select('week_id, menu_data')
        .order('week_id', { ascending: false })
        .limit(1)
        .single();
    if (error) throw new Error(`weekly_menus read failed: ${error.message}`);
    console.log(`  using ${data.week_id}`);
    const menu = data.menu_data;

    const targets = [];
    for (const [canteenName, canteen] of Object.entries(menu.canteens)) {
        for (const day of DAY_ORDER) {
            const entry = canteen.menu.find((d) => d.day.toLowerCase() === day);
            const main = getDayItems(entry).find((i) => i.isMain);
            if (!main || isDishClosed(main.dish)) continue;
            targets.push({ canteenName, day, dish: main.dish });
        }
    }

    console.log(`Found ${targets.length} main dishes to regenerate.\n`);

    let ok = 0, fail = 0;
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        const label = `${t.canteenName}/${t.day}: ${t.dish.substring(0, 40)}`;
        console.log(`📸 [${i + 1}/${targets.length}] ${label}…`);
        try {
            const generated = await generateSingleImage(t.dish, t.canteenName, t.day);
            if (!generated) {
                console.error('  ❌ generation returned false');
                fail++;
                continue;
            }
            const removed = await removeBgSingle(t.canteenName, t.day);
            if (!removed) {
                console.error('  ⚠️  bg removal returned false (image still uploaded with bg)');
            }
            ok++;
            console.log('  ✅ done');
        } catch (e) {
            fail++;
            console.error(`  ❌ ${e.message}`);
        }
        // Small jitter between calls to avoid rate-limit clustering.
        await new Promise((r) => setTimeout(r, 800));
    }

    console.log(`\n🏁 Done — ${ok} ok, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
