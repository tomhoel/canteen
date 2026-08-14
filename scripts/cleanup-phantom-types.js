// package.json sets "type": "module", so this file must be ESM. It previously
// used require() and only survived because Node fell back to CJS detection.
import fs from 'node:fs';
import path from 'node:path';

const typesDir = path.join('node_modules', '@types');
if (!fs.existsSync(typesDir)) process.exit(0);

fs.readdirSync(typesDir)
  .filter((d) => d.includes(' '))
  .forEach((d) => {
    const fullPath = path.join(typesDir, d);
    fs.rmSync(fullPath, { recursive: true, force: true });
    console.log('Removed phantom @types dir:', d);
  });
