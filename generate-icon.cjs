const sharp = require('sharp');
const fs = require('fs');

const svgBuffer = fs.readFileSync('./public/icon.svg');

// Generate apple-touch-icon (180x180 is the standard size)
sharp(svgBuffer)
  .resize(180, 180)
  .png()
  .toFile('./public/apple-touch-icon.png')
  .then(() => console.log('✓ Generated apple-touch-icon.png'))
  .catch(err => console.error('Error:', err));

// Generate standard favicon (32x32)
sharp(svgBuffer)
  .resize(32, 32)
  .png()
  .toFile('./public/favicon-32x32.png')
  .then(() => console.log('✓ Generated favicon-32x32.png'))
  .catch(err => console.error('Error:', err));

// Generate larger favicon (192x192 for Android)
sharp(svgBuffer)
  .resize(192, 192)
  .png()
  .toFile('./public/icon-192.png')
  .then(() => console.log('✓ Generated icon-192.png'))
  .catch(err => console.error('Error:', err));

// Generate extra large icon (512x512 for Android)
sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile('./public/icon-512.png')
  .then(() => console.log('✓ Generated icon-512.png'))
  .catch(err => console.error('Error:', err));
