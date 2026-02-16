#!/bin/bash
# Weekly Menu Update Script
# Runs Monday 09:00 and Tuesday 09:00 (backup in case menu isn't published Monday)
# Scrapes menu, generates food images, removes backgrounds, rebuilds static site

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/update.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "========================================"
echo "🍽️  WEEKLY MENU UPDATE"
echo "📅 $(date '+%A %d %B %Y, %H:%M')"
echo "========================================"
echo ""

# Ensure node and python are available (needed for cron which has minimal PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Step 1: Scrape menu
echo "📥 Step 1: Scraping latest menu..."
node scraper.js || { echo "❌ Scraping failed"; exit 1; }
echo "✅ Menu scraped"
echo ""

# Step 2: Generate food images for all weekdays
echo "📸 Step 2: Generating food images..."
node generate-images-v2.js || { echo "❌ Image generation failed"; exit 1; }
echo "✅ Images generated"
echo ""

# Step 3: Remove backgrounds
echo "🎨 Step 3: Removing backgrounds..."
python3 remove-bg-v2.py || { echo "❌ Background removal failed"; exit 1; }
echo "✅ Backgrounds removed"
echo ""

# Step 4: AI quality review (regenerates bad images)
echo "🔍 Step 4: Reviewing image quality..."
node review-images.js || { echo "⚠️ Review had issues, continuing..."; }
echo ""

# Step 5: Validate images
echo "📐 Step 5: Validating images..."
node validate-images.js
echo ""

# Step 6: Rebuild static site so dist/ is updated
echo "🔨 Step 6: Rebuilding static site..."
npm run build || { echo "❌ Build failed"; exit 1; }
echo "✅ Site rebuilt"
echo ""

echo "========================================"
echo "🎉 UPDATE COMPLETE! $(date '+%H:%M')"
echo "========================================"
