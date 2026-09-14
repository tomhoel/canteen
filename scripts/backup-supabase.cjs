#!/usr/bin/env node
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
});

const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'supabase');

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function backupTable(tableName, outputFile) {
  console.log(`Exporting table ${tableName}...`);
  let allRows = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + limit - 1);

    if (error) {
      console.error(`Error exporting ${tableName}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }

  fs.writeFileSync(outputFile, JSON.stringify(allRows, null, 2), 'utf8');
  console.log(`✅ Saved ${allRows.length} rows to ${path.relative(process.cwd(), outputFile)}`);
}

async function listAllBucketFiles(bucket, prefix = '') {
  const files = [];
  const queue = [prefix];

  while (queue.length > 0) {
    const current = queue.shift();
    let offset = 0;
    const limit = 100;

    while (true) {
      const { data, error } = await supabase.storage.from(bucket).list(current, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });

      if (error) {
        console.error(`Error listing ${bucket}/${current}:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;

      for (const item of data) {
        const itemPath = current ? `${current}/${item.name}` : item.name;
        if (!item.id && !item.metadata) {
          queue.push(itemPath);
        } else if (item.metadata) {
          files.push({ path: itemPath, size: item.metadata.size, mimetype: item.metadata.mimetype });
        }
      }

      if (data.length < limit) break;
      offset += limit;
    }
  }
  return files;
}

async function backupBucket(bucketName) {
  console.log(`\nExporting bucket '${bucketName}'...`);
  const files = await listAllBucketFiles(bucketName);
  console.log(`Found ${files.length} files in bucket '${bucketName}'. Downloading...`);

  const bucketDir = path.join(BACKUP_DIR, 'buckets', bucketName);
  await ensureDir(bucketDir);

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const localFilePath = path.join(bucketDir, file.path);
    await ensureDir(path.dirname(localFilePath));

    try {
      const { data, error } = await supabase.storage.from(bucketName).download(file.path);
      if (error || !data) throw error || new Error('No data received');

      const buf = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(localFilePath, buf);
      successCount++;
    } catch (err) {
      console.error(`  ❌ Failed to download ${file.path}:`, err.message);
      failCount++;
    }
  }

  console.log(`✅ Downloaded ${successCount} files from '${bucketName}' (${failCount} failed).`);
}

async function main() {
  console.log('🚀 Starting full Supabase backup to backups/supabase/...\n');
  const dataDir = path.join(BACKUP_DIR, 'data');
  await ensureDir(dataDir);

  // 1. Export tables
  await backupTable('weekly_menus', path.join(dataDir, 'weekly_menus.json'));
  await backupTable('dish_cache', path.join(dataDir, 'dish_cache.json'));
  await backupTable('canteen_attendance', path.join(dataDir, 'canteen_attendance.json'));

  // 2. Export storage buckets
  await backupBucket('images');
  await backupBucket('images_nobg');

  console.log('\n🎉 Supabase backup complete! All data and images safely stored in backups/supabase/.');
}

main().catch(console.error);
