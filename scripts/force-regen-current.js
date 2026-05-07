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

require('dotenv').config({ path: '.env.local' });
const https = require('https');
const { generateSingleImage, removeBgSingle, getDayItems, isDishClosed, DAY_ORDER } = require('../smart-update.js');

const MENU_URL = process.env.MENU_URL || 'https://fbueat.vercel.app/menu.json';

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode} from ${url}`));
                return;
            }
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function main() {
    console.log(`📡 Fetching menu from ${MENU_URL}…`);
    const menu = await fetchJson(MENU_URL);

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
