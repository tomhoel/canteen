import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMenuFixture, buildAttendanceFixture } from "./fixture.js";

/**
 * Serves the production build against a fixed menu.
 *
 * Not `vite preview`: its `/api` middleware loads `api/*.ts` through Node's
 * TypeScript stripping, and those files import `"../src/server/menu.js"` — the
 * `.js` extension Vercel requires at runtime, which the loader cannot map back
 * to `.ts`. It answers 500 locally and always has.
 *
 * Serving a fixture rather than proxying the real API is the point. The tests
 * assert on card geometry and animation counts; pointing them at production
 * would make them fail when a kitchen publishes a longer dish name, which is
 * both useless as a signal and impossible to debug from a CI log.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, "..", "dist");
const PORT = Number(process.env.E2E_PORT ?? 4176);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/api/menu") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    return res.end(JSON.stringify(buildMenuFixture()));
  }

  if (url.pathname === "/api/attendance") {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    return res.end(JSON.stringify(buildAttendanceFixture()));
  }

  // Anything else under /api is a route these tests do not exercise. Answering
  // 404 rather than falling through to index.html keeps a typo in a fetch from
  // looking like a successful HTML response.
  if (url.pathname.startsWith("/api/")) {
    res.writeHead(404, { "content-type": TYPES[".json"] });
    return res.end(JSON.stringify({ error: "not stubbed" }));
  }

  let file = path.join(DIST, url.pathname === "/" ? "index.html" : url.pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, "index.html");
  }
  res.writeHead(200, {
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(file).pipe(res);
});

if (!fs.existsSync(DIST)) {
  console.error(`e2e: ${DIST} does not exist — run \`npm run build\` first.`);
  process.exit(1);
}

server.listen(PORT, () => console.log(`e2e server on http://localhost:${PORT}`));
