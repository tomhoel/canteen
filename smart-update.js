#!/usr/bin/env node
/**
 * Smart Weekly Update
 * Compares old menu with freshly scraped menu.
 * Only regenerates images for canteens whose main dishes actually changed.
 * Saves Gemini API calls by skipping canteens that are already up-to-date.
 */

import fs from 'fs';
import path from 'path';
import ws from 'ws';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sloutnqpqfesyoycklgd.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsb3V0bnFwcWZlc3lveWNrbGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NzQ2NzYsImV4cCI6MjA5MzU1MDY3Nn0.8QQbCvzFkZzQjJUEYBhBxAHJ-wgf-tfFyj5i-3sUfdo";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

export const DAY_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const CLOSED_KEYWORDS = ['stengt', 'closed', 'lukket'];

/** Returns true if a dish name is a "closed" placeholder, not real food. */
export function isDishClosed(dishName) {
    if (!dishName) return true;
    const lower = dishName.toLowerCase();
    return CLOSED_KEYWORDS.some(kw => lower.includes(kw));
}

/** Returns items prioritizing Norwegian over English */
export function getDayItems(entry) {
    const no = entry?.no?.items || [];
    const en = entry?.en?.items || [];
    return no.length > 0 ? no : en;
}

/** Ranks main dishes, penalizing Pizza for Eat the street and soups/sides */
export function scoreMainDish(dish, canteenName) {
    let score = 0;
    const lower = (dish || '').toLowerCase();
    if (canteenName === "Eat the street" && lower.includes("pizza")) return -100;
    if (lower.includes("pizza")) score -= 80;
    if (lower.includes("suppe") || lower.includes("soup")) score -= 50;
    if (/biff|beef|steak|karbonad|patties|patty|kylling|chicken|svin|pork|torsk|cod|laks|salmon|rødspette|plaice|elg|moose|stroganoff|gyros|wings|coq au vin|panert|breaded|slakterbiff|hanger|kjøtt|meat|bolognese|tortilla|casserole/i.test(lower)) score += 50;
    if (/med stekte|with fried|med fløte|with cream|med poteter|with potatoes|med fries|with fries|serveres med|served with|med ris/i.test(lower)) score += 30;
    if (/^stekt ris|^fried rice|^couscous|^nudler|^noodles|^falafel|^linsegryte|^lentil|^bønnegryte|^bean stew|^sopprisotto|^mushroom risotto/i.test(lower)) score -= 30;
    return score;
}

export async function runSmartUpdate() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  SMART WEEKLY UPDATE                                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    const { runWeeklyUpdateService } = await import('./src/server/services/menu.service.js');
    const { processAllCanteenAIImages } = await import('./src/server/services/image.service.js');

    const record = await runWeeklyUpdateService();
    console.log(`\n🔍 Auditing and generating AI dish images for main dishes (${record.weekId})...`);
    await processAllCanteenAIImages(record.menuData);

    console.log('\n🏁 FINISHED SMART UPDATE');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    runSmartUpdate().catch(console.error);
}
