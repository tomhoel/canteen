#!/usr/bin/env node
/**
 * Image Validation & Consistency Checker
 * Reports on image dimensions, file sizes, and quality metrics
 */

const fs = require('fs');
const path = require('path');

let sharp;
try {
    sharp = require('sharp');
} catch (e) {
    console.error('Sharp required. Install with: npm install sharp');
    process.exit(1);
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const CANTEENS = ['the_hub', 'telenor_expo', 'bygg_b'];

// Standard requirements
const REQUIREMENTS = {
    minWidth: 512,
    minHeight: 512,
    maxWidth: 2048,
    maxHeight: 2048,
    minSizeKB: 10,
    maxSizeKB: 2000,
    aspectRatio: { width: 1, height: 1, tolerance: 0.1 } // 1:1 ±10%
};

async function analyzeImage(imagePath) {
    try {
        const stats = fs.statSync(imagePath);
        const metadata = await sharp(imagePath).metadata();
        
        return {
            path: imagePath,
            filename: path.basename(imagePath),
            width: metadata.width,
            height: metadata.height,
            sizeKB: Math.round(stats.size / 1024),
            format: metadata.format,
            hasAlpha: metadata.hasAlpha,
            aspectRatio: metadata.width / metadata.height
        };
    } catch (error) {
        return {
            path: imagePath,
            filename: path.basename(imagePath),
            error: error.message
        };
    }
}

function checkCompliance(analysis) {
    const issues = [];
    
    if (analysis.error) {
        issues.push(`ERROR: ${analysis.error}`);
        return issues;
    }
    
    // Size checks
    if (analysis.sizeKB < REQUIREMENTS.minSizeKB) {
        issues.push(`File too small (${analysis.sizeKB}KB < ${REQUIREMENTS.minSizeKB}KB)`);
    }
    if (analysis.sizeKB > REQUIREMENTS.maxSizeKB) {
        issues.push(`File too large (${analysis.sizeKB}KB > ${REQUIREMENTS.maxSizeKB}KB)`);
    }
    
    // Dimension checks
    if (analysis.width < REQUIREMENTS.minWidth) {
        issues.push(`Width too small (${analysis.width}px < ${REQUIREMENTS.minWidth}px)`);
    }
    if (analysis.height < REQUIREMENTS.minHeight) {
        issues.push(`Height too small (${analysis.height}px < ${REQUIREMENTS.minHeight}px)`);
    }
    
    // Aspect ratio check
    const targetRatio = REQUIREMENTS.aspectRatio.width / REQUIREMENTS.aspectRatio.height;
    const ratioDiff = Math.abs(analysis.aspectRatio - targetRatio);
    if (ratioDiff > REQUIREMENTS.aspectRatio.tolerance) {
        issues.push(`Aspect ratio off (${analysis.aspectRatio.toFixed(2)} vs ${targetRatio})`);
    }
    
    return issues;
}

async function main() {
    const baseDir = path.join(__dirname, 'public', 'images');
    const nobgDir = path.join(__dirname, 'public', 'images_nobg');
    
    console.log('🔍 IMAGE VALIDATION REPORT');
    console.log('='.repeat(60));
    
    const allAnalyses = [];
    const issues = [];
    
    for (const day of DAYS) {
        console.log(`\n📅 ${day.toUpperCase()}`);
        
        for (const canteen of CANTEENS) {
            const filename = `${canteen}.png`;
            const imagePath = path.join(baseDir, day, filename);
            
            if (!fs.existsSync(imagePath)) {
                console.log(`  ❌ ${filename}: MISSING`);
                issues.push({ file: `${day}/${filename}`, issues: ['File not found'] });
                continue;
            }
            
            const analysis = await analyzeImage(imagePath);
            allAnalyses.push(analysis);
            
            const fileIssues = checkCompliance(analysis);
            
            if (fileIssues.length === 0) {
                console.log(`  ✅ ${filename}: ${analysis.width}x${analysis.height} (${analysis.sizeKB}KB)`);
            } else {
                console.log(`  ⚠️  ${filename}:`);
                fileIssues.forEach(issue => console.log(`      - ${issue}`));
                issues.push({ file: `${day}/${filename}`, issues: fileIssues });
            }
        }
    }
    
    // Summary statistics
    console.log('\n' + '='.repeat(60));
    console.log('📊 STATISTICS');
    console.log('='.repeat(60));
    
    if (allAnalyses.length > 0) {
        const validAnalyses = allAnalyses.filter(a => !a.error);
        
        // Dimensions
        const widths = validAnalyses.map(a => a.width);
        const heights = validAnalyses.map(a => a.height);
        console.log(`\nDimensions:`);
        console.log(`  Width:  ${Math.min(...widths)}-${Math.max(...widths)}px`);
        console.log(`  Height: ${Math.min(...heights)}-${Math.max(...heights)}px`);
        
        // Consistency check
        const uniqueWidths = [...new Set(widths)];
        const uniqueHeights = [...new Set(heights)];
        if (uniqueWidths.length === 1 && uniqueHeights.length === 1) {
            console.log(`  ✅ All images same size: ${uniqueWidths[0]}x${uniqueHeights[0]}`);
        } else {
            console.log(`  ⚠️  Inconsistent sizes detected`);
            console.log(`     Widths:  ${[...uniqueWidths].join(', ')}`);
            console.log(`     Heights: ${[...uniqueHeights].join(', ')}`);
        }
        
        // File sizes
        const sizes = validAnalyses.map(a => a.sizeKB);
        const avgSize = Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length);
        console.log(`\nFile sizes:`);
        console.log(`  Range: ${Math.min(...sizes)}-${Math.max(...sizes)}KB`);
        console.log(`  Average: ${avgSize}KB`);
        
        // Alpha channel check
        const withAlpha = validAnalyses.filter(a => a.hasAlpha).length;
        console.log(`\nTransparency:`);
        console.log(`  With alpha: ${withAlpha}/${validAnalyses.length}`);
    }
    
    // Issues summary
    console.log('\n' + '='.repeat(60));
    console.log(`📋 ISSUES SUMMARY: ${issues.length} files with problems`);
    console.log('='.repeat(60));
    
    if (issues.length > 0) {
        issues.forEach(({ file, issues: fileIssues }) => {
            console.log(`\n${file}:`);
            fileIssues.forEach(issue => console.log(`  - ${issue}`));
        });
    } else {
        console.log('\n✅ All images pass validation!');
    }
    
    // Check for nobg versions
    console.log('\n' + '='.repeat(60));
    console.log('🔍 BACKGROUND-REMOVED IMAGES CHECK');
    console.log('='.repeat(60));
    
    let nobgCount = 0;
    for (const day of DAYS) {
        const dayDir = path.join(nobgDir, day);
        if (fs.existsSync(dayDir)) {
            const files = fs.readdirSync(dayDir).filter(f => f.endsWith('.png'));
            nobgCount += files.length;
        }
    }
    console.log(`Found ${nobgCount} background-removed images`);
    
    if (nobgCount < allAnalyses.length) {
        console.log(`⚠️  Missing ${allAnalyses.length - nobgCount} nobg versions`);
        console.log('   Run: node remove-bg.js or node remove-greenscreen.js');
    }
}

main().catch(console.error);
