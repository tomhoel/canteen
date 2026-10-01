// One-off companion to restore-plates.ts: make sure every plate in the backup exists in
// storage both as the full image and as its 512px thumb, and fill any gap (a network
// blip during the bulk upload can lose one or the other).
// Usage: node --env-file=.env --import tsx scripts/verify-plates.ts
import fs from "node:fs";
import path from "node:path";
import { putObject, objectExists } from "../src/server/services/storage.service.js";
import { makePlateThumb } from "../src/server/services/image.service.js";

const dir = "backups/supabase/buckets/images_nobg/archive";
const MONTH = 30 * 24 * 60 * 60;
let fixedFull = 0;
let fixedThumb = 0;
let unknown = 0;

const queue = fs.readdirSync(dir);
await Promise.all(
  Array.from({ length: 6 }, async () => {
    for (let name = queue.shift(); name; name = queue.shift()) {
      const bytes = () => fs.readFileSync(path.join(dir, name!));
      const full = await objectExists("images_nobg", `archive/${name}`);
      const thumb = await objectExists("images_nobg", `thumb/archive/${name}`);
      if (full === null || thumb === null) unknown++;
      if (full === false) {
        await putObject("images_nobg", `archive/${name}`, bytes(), "image/webp", MONTH);
        fixedFull++;
      }
      if (thumb === false) {
        await putObject("images_nobg", `thumb/archive/${name}`, await makePlateThumb(bytes()), "image/webp", MONTH);
        fixedThumb++;
      }
    }
  })
);
console.log(`filled ${fixedFull} missing plates and ${fixedThumb} missing thumbs; ${unknown} could not be checked`);
