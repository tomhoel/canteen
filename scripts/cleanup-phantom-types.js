const fs = require('fs');
const path = require('path');

const typesDir = path.join('node_modules', '@types');
if (!fs.existsSync(typesDir)) process.exit(0);

fs.readdirSync(typesDir)
  .filter(d => d.includes(' '))
  .forEach(d => {
    const fullPath = path.join(typesDir, d);
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log('Removed phantom @types dir:', d);
  });
