#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Redis } = require('@upstash/redis');

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  console.error('Missing Upstash Redis credentials in environment');
  process.exit(1);
}

const redis = new Redis({ url: redisUrl, token: redisToken });
const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'supabase', 'data');

async function migrateDishCache() {
  const filePath = path.join(BACKUP_DIR, 'dish_cache.json');
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return;
  }

  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`Migrating ${rows.length} dish_cache entries to Upstash Redis...`);

  // Batch in chunks of 100 using hset
  const CHUNK = 100;
  let totalSaved = 0;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const hashData = {};

    for (const row of slice) {
      const entry = {
        cacheKey: row.cache_key,
        originalName: row.original_name,
        origin: row.origin || null,
        description: row.description || null,
        shortName: row.short_name || null,
        imagePath: row.image_path || null,
        imageNoBgPath: row.image_nobg_path || null,
        enrichAttempts: row.enrich_attempts || 0,
        lastEnrichAttempt: row.last_enrich_attempt || null,
      };
      hashData[row.cache_key] = JSON.stringify(entry);
    }

    await redis.hset('dish_cache', hashData);
    totalSaved += slice.length;
  }

  console.log(`✅ Successfully stored ${totalSaved} dishes in 'dish_cache' hash.`);
}

async function migrateWeeklyMenus() {
  const filePath = path.join(BACKUP_DIR, 'weekly_menus.json');
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return;
  }

  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`\nMigrating ${rows.length} weekly_menus to Upstash Redis...`);

  for (const row of rows) {
    const record = {
      weekId: row.week_id,
      menuData: row.menu_data,
      dishOrigins: row.dish_origins || {},
      dishDescriptions: row.dish_descriptions || {},
      dishShortNames: row.dish_short_names || {},
      scrapedAt: row.scraped_at,
    };

    // Store record permanently
    await redis.set(`menu:${row.week_id}`, record);

    // Track week in sorted set (score = YYYY * 100 + WW)
    const match = row.week_id.match(/^(\d{4})-W(\d{1,2})$/);
    const score = match ? parseInt(match[1], 10) * 100 + parseInt(match[2], 10) : 0;
    await redis.zadd('menu:weeks', { score, member: row.week_id });
  }

  console.log(`✅ Stored ${rows.length} weekly menus in Redis.`);
}

async function migrateAttendance() {
  const filePath = path.join(BACKUP_DIR, 'canteen_attendance.json');
  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return;
  }

  const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log(`\nMigrating ${rows.length} attendance rows to Upstash Redis...`);

  for (const row of rows) {
    await redis.hset(`attendance:${row.vote_date}`, {
      [row.canteen_name]: row.vote_count,
    });
  }

  console.log(`✅ Stored attendance records in Redis.`);
}

async function main() {
  console.log('🚀 Starting Upstash Redis data migration...\n');
  await migrateDishCache();
  await migrateWeeklyMenus();
  await migrateAttendance();
  console.log('\n🎉 Upstash Redis migration completed successfully!');
}

main().catch(console.error);
