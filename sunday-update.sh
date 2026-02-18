#!/bin/bash
# Sunday Weekly Update Script - VERSION 2
# Shows plates with food, consistent 45° angle

echo "🍽️  LUNCH MENU - SUNDAY UPDATE (v2)"
echo "================================"
echo ""

# Step 1: Scrape menu
echo "📥 Step 1: Scraping latest menu..."
node scraper.js || exit 1
echo "✅ Menu updated"
echo ""

# Step 2: Generate with plates visible
echo "📸 Step 2: Generating images (with plates)..."
node generate-images-v2.js || exit 1
echo "✅ Images generated"
echo ""

# Step 3: Remove backgrounds
echo "🎨 Step 3: Removing backgrounds..."
python3 remove-bg-v2.py || exit 1
echo "✅ Backgrounds removed"
echo ""

# Step 4: Validate
echo "🔍 Step 4: Validating..."
node validate-images.js
echo ""

echo "================================"
echo "🎉 WEEKLY UPDATE COMPLETE!"
echo "================================"
echo "View: http://localhost:3000"
