#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { put, list } = require('@vercel/blob');

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error('❌ Missing BLOB_READ_WRITE_TOKEN in environment.');
  console.log('To set up Vercel Blob:');
  console.log('1. Go to your Vercel Dashboard -> Project "canteen" -> Storage tab');
  console.log('2. Click "Create Database" -> select "Blob" -> attach to project');
  console.log('3. Run `vercel env pull` or copy BLOB_READ_WRITE_TOKEN into your .env');
  process.exit(1);
}

const BACKUP_DIR = path.join(__dirname, '..', 'backups', 'supabase', 'buckets');

async function uploadDir(localDir, prefix = '') {
  if (!fs.existsSync(localDir)) return;

  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullLocalPath = path.join(localDir, entry.name);
    const blobPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await uploadDir(fullLocalPath, blobPath);
    } else {
      const buf = fs.readFileSync(fullLocalPath);
      const isPng = entry.name.endsWith('.png');
      const contentType = isPng ? 'image/png' : 'image/webp';

      try {
        const blob = await put(blobPath, buf, {
          access: 'public',
          addRandomSuffix: false,
          contentType,
          token,
        });
        console.log(`  ✅ Uploaded: ${blobPath} -> ${blob.url}`);
      } catch (err) {
        console.error(`  ❌ Failed: ${blobPath} (${err.message})`);
      }
    }
  }
}

async function main() {
  console.log('🚀 Starting Vercel Blob migration from backups/supabase/buckets/...\n');

  // 1. Upload images_nobg (archive/ and closed-plates/)
  const nobgDir = path.join(BACKUP_DIR, 'images_nobg');
  console.log(`Uploading images_nobg files to Blob (under images_nobg/)...`);
  await uploadDir(nobgDir, 'images_nobg');

  // 2. Upload images (reference/)
  const imgDir = path.join(BACKUP_DIR, 'images');
  console.log(`\nUploading images files to Blob (under images/)...`);
  await uploadDir(imgDir, 'images');

  console.log('\n🎉 Vercel Blob upload completed!');
}

main().catch(console.error);
