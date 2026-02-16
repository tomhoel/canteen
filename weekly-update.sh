#!/bin/bash
# Weekly Menu Update Script
# Runs Monday 09:00 and Tuesday 09:00 (backup in case menu isn't published Monday)
# Smart update: only regenerates images for canteens whose menus actually changed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="$SCRIPT_DIR/update.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo ""
echo "========================================"
echo "🍽️  WEEKLY MENU UPDATE (SMART)"
echo "📅 $(date '+%A %d %B %Y, %H:%M')"
echo "========================================"
echo ""

# Ensure node and python are available (needed for cron which has minimal PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Smart update: scrape, compare, only regenerate what changed
echo "🧠 Running smart update..."
node smart-update.js || { echo "❌ Smart update failed"; exit 1; }
echo ""

# Rebuild static site
echo "🔨 Rebuilding static site..."
npm run build || { echo "❌ Build failed"; exit 1; }
echo "✅ Site rebuilt"
echo ""

echo "========================================"
echo "🎉 UPDATE COMPLETE! $(date '+%H:%M')"
echo "========================================"
