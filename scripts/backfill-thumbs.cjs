// One-off: write images_nobg/thumb/<path> for every plate that lacks one.
// New plates get theirs from uploadToStorage; this covers what predates it.
// Idempotent. Usage: node --env-file=.env scripts/backfill-thumbs.cjs [--dry]
const { list, put } = require("@vercel/blob");
const sharp = require("sharp");

const dry = process.argv.includes("--dry");

async function all(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  return out;
}

(async () => {
  const blobs = await all("images_nobg/");
  const have = new Set(blobs.filter((b) => b.pathname.startsWith("images_nobg/thumb/")).map((b) => b.pathname));
  const todo = blobs.filter(
    (b) => !b.pathname.startsWith("images_nobg/thumb/") && !have.has(`images_nobg/thumb/${b.pathname.slice("images_nobg/".length)}`)
  );
  console.log(`${blobs.length} blobs, ${todo.length} need a thumb`);
  let done = 0;
  for (const b of todo) {
    const rel = b.pathname.slice("images_nobg/".length);
    if (dry) { console.log("would thumb", rel); continue; }
    const src = Buffer.from(await (await fetch(b.url)).arrayBuffer());
    const thumb = await sharp(src).resize(512).webp({ quality: 78, alphaQuality: 85 }).toBuffer();
    await put(`images_nobg/thumb/${rel}`, thumb, {
      access: "public", addRandomSuffix: false, contentType: "image/webp", allowOverwrite: true,
    });
    done++;
    console.log(`${done}/${todo.length} ${rel} ${(src.length / 1024) | 0}KB -> ${(thumb.length / 1024) | 0}KB`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
