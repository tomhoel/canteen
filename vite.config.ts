import WebSocket from "ws";
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { ServerResponse } from "node:http";

/**
 * Shortens the production critical path, all inside index.html.
 *
 * Three separate problems, measured on a cold load of the deployed app:
 *
 * 1. The render-blocking stylesheet was the LAST thing in <head>, at byte
 *    ~23,400 of a comment-heavy document. Nothing can paint before it lands —
 *    `#root { visibility: hidden }` in the inline <style> is released by a rule
 *    inside that file — so its discovery time is first paint's floor.
 *
 * 2. ~17 KB of explanatory comments sat in front of all of it, in HTML
 *    comments and in the inline <style>. They are worth keeping in source and
 *    worth nothing to a browser — and the inline <style> is render-blocking, so
 *    its comments are the expensive kind. 1,763 of that block's 2,716 bytes.
 *
 * A third problem used to live here: `routes-*.js` was reached by a dynamic
 * import the preload scanner could not see, so this plugin injected
 * modulepreload tags for it. The router was removed and HomeClient is a static
 * import again — the build emits zero `routes-*` chunks, so that code matched
 * nothing. Deleted rather than left looking load-bearing.
 *
 * Build only — the dev server has no <link> to move (Vite serves CSS through
 * JS there) and the comments help while editing.
 */
function shortenCriticalPath(): Plugin {
  return {
    name: "canteen-shorten-critical-path",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Strip HTML comments. Safe here because no <script> or <style> in this
        // document contains the literal `<!--`; the inline scripts use `//` and
        // the inline styles use `/* */`.
        let out = html.replace(/<!--[\s\S]*?-->\s*/g, "");

        // Hoist the stylesheet so the preload scanner finds it near the top.
        //
        // CRITICALLY: after the inline <style>, never before it. The inline
        // block sets `#root { visibility: hidden }` and globals.css releases it
        // with `#root { visibility: visible }` — equal specificity, so the
        // later rule wins. Moving the stylesheet above the inline style would
        // invert that and leave the app permanently blank.
        const linkRe = /\s*<link[^>]+rel="stylesheet"[^>]*>/;
        const link = out.match(linkRe);
        const styleEnd = out.indexOf("</style>");
        if (link && styleEnd !== -1) {
          out = out.replace(linkRe, "");
          const at = out.indexOf("</style>") + "</style>".length;
          out = out.slice(0, at) + "\n    " + link[0].trim() + out.slice(at);
        }

        // Strip comments from the inline <style> only.
        //
        // That block is render-blocking twice over: it is parser-blocking where
        // it sits, and it sets `#root { visibility: hidden }`, so nothing paints
        // until the stylesheet hoisted above releases it. 1,763 of its 2,716
        // bytes were prose explaining decisions to whoever edits index.html,
        // which is worth keeping in source and worth nothing over the wire.
        //
        // Scoped to the <style> element rather than run over the whole document
        // because `/* */` is not a comment inside the inline <script> strings or
        // in any URL it builds.
        out = out.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (_m, open, css, close) =>
          open + css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n{2,}/g, "\n") + close
        );

        return out;
      },
    },
  };
}

/**
 * Serves the api/ functions during `npm run dev`.
 *
 * In production Vercel turns every file under api/ into a serverless function.
 * The Vite dev server knows nothing about that, so without this the app would
 * only work when deployed. This loads the same handler modules through Vite's
 * SSR pipeline and adapts Node's req/res to the small slice of the Vercel
 * signature the handlers actually use.
 */
function devApiPlugin(): Plugin {
  /**
   * `load` differs by server: the dev server goes through Vite's SSR pipeline
   * so handler edits hot-reload, while the preview server has no such pipeline
   * and relies on Node's native TypeScript stripping instead.
   */
  const makeMiddleware = (
    load: (file: string) => Promise<Record<string, any>>
  ): Connect.NextHandleFunction => {
    return async (req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api/")) return next();

        const parsed = new URL(url, "http://localhost");
        // "/api/menu" -> "api/menu"; strip any trailing slash.
        const routePath = parsed.pathname.replace(/\/+$/, "").slice(1);

        // Resolve "api/menu" to api/menu.ts or api/menu/index.ts.
        const candidates = [
          path.resolve(process.cwd(), `${routePath}.ts`),
          path.resolve(process.cwd(), routePath, "index.ts"),
        ];
        const file = candidates.find((c) => fs.existsSync(c));
        if (!file) return next();

        try {
          const mod = await load(file);
          const handler = mod.default;
          if (typeof handler !== "function") return next();

          // Collect the body so handlers can read req.body like Vercel's do.
          const raw = await new Promise<string>((resolve, reject) => {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(Buffer.from(c)));
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
            req.on("error", reject);
          });

          const query: Record<string, string | string[]> = {};
          parsed.searchParams.forEach((value, key) => {
            query[key] = value;
          });

          let body: unknown = undefined;
          if (raw) {
            try {
              body = JSON.parse(raw);
            } catch {
              body = raw;
            }
          }

          const vercelRes = res as ServerResponse & {
            status: (code: number) => typeof vercelRes;
            json: (payload: unknown) => typeof vercelRes;
          };
          vercelRes.status = (code: number) => {
            res.statusCode = code;
            return vercelRes;
          };
          vercelRes.json = (payload: unknown) => {
            if (!res.headersSent) res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(payload));
            return vercelRes;
          };

          await handler(Object.assign(req, { query, body }), vercelRes);
        } catch (err) {
          console.error(`[dev-api] ${routePath} failed:`, err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
          }
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      };
  };

  return {
    name: "canteen-dev-api",
    configureServer(server) {
      // Register before Vite's SPA fallback so /api/* is never rewritten to index.html.
      server.middlewares.use(makeMiddleware((file) => server.ssrLoadModule(file)));
    },
    configurePreviewServer(server) {
      // `npm start` serves the built client; without this the API would 404
      // and the production build could not be exercised locally at all.
      server.middlewares.use(
        makeMiddleware((file) => import(pathToFileURL(file).href))
      );
    },
  };
}

/**
 * Emits a precache service worker, built only.
 *
 * The app has a manifest and `display: standalone`, so Android installs it —
 * with zero precache. Every home-screen launch was a full network load of the
 * ~125 KB brotli critical path, which is what made an app you opened yesterday
 * still feel like a cold start.
 *
 * Hand-written rather than vite-plugin-pwa + workbox. The whole job is "cache
 * this list of files", the list comes from the bundle we are already walking,
 * and a dependency whose config surface is larger than the thing it generates
 * is a poor trade for 40 lines.
 *
 * Two rules, and the split between them is the entire safety story:
 *
 * - **Hashed assets are cache-first.** /assets/* and /fonts/* are content-
 *   addressed and already served `max-age=31536000, immutable`. A stale one is
 *   not possible: different content means a different filename, and a filename
 *   we have never seen simply misses and goes to network.
 *
 * - **The document is network-first, falling back to cache.** This is the part
 *   that keeps a bad deploy recoverable. Serving a cached index.html would be
 *   faster, but the HTML is what names the asset hashes, so a stale copy is how
 *   you get an app pinned to a broken build with no way to clear it from a
 *   phone. This codebase has already shipped that class of bug twice through a
 *   six-hour localStorage cache; it is not worth repeating for ~200 ms.
 *
 * /api/* is deliberately untouched. Those responses have their own
 * Cache-Control and a stale-while-revalidate story the CDN already implements,
 * and a second, invisible cache layer in front of them is exactly how a menu
 * goes stale in a way nobody can explain.
 */
function precacheServiceWorker(): Plugin {
  return {
    name: "canteen-precache-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      // Only what first paint needs: the entry chunk and its STATIC import
      // graph, plus the CSS those pull in. Dynamic imports are deliberately
      // excluded — precaching every modal and view would make install download
      // the whole app to speed up a launch that never opens them, and the
      // fetch handler below caches a lazy chunk the first time it is actually
      // used anyway.
      const eager = new Set<string>();
      const walk = (file: string) => {
        const c: any = bundle[file];
        if (!c || eager.has(file)) return;
        eager.add(file);
        for (const css of c.viteMetadata?.importedCss ?? []) eager.add(css);
        for (const imp of c.imports ?? []) walk(imp);
      };
      for (const [file, chunk] of Object.entries(bundle)) {
        if ((chunk as any).isEntry) walk(file);
      }

      // Fonts are referenced from CSS, not the bundle graph, so they are named
      // explicitly. Only the latin face: Norwegian æ/ø/å live in U+0000-00FF,
      // so latin-ext is declared but never fetched.
      const precache = [...[...eager].sort().map((f) => `/${f}`), "/fonts/outfit-latin.woff2"];

      // The cache name carries the asset hashes, so any deploy that changes a
      // chunk gets a fresh cache and `activate` deletes every older one. No
      // manual version to forget to bump.
      const version = createHash("sha256").update(precache.join("|")).digest("hex").slice(0, 12);

      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `// Generated by vite.config.ts — do not edit.
const CACHE = "canteen-${version}";
const PRECACHE = ${JSON.stringify(precache, null, 2)};

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase plates, etc.
  if (url.pathname.startsWith("/api/")) return;      // the CDN owns these

  // The document: network first, cache only as a fallback. A stale document
  // names stale asset hashes, which is an app nobody can un-break from a phone.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
    );
    return;
  }

  // Hashed, immutable assets: cache first. A miss just means a new build.
  if (/^\\/(assets|fonts)\\//.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
      )
    );
  }
});
`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // The api/ handlers read plain process.env, exactly as they will on Vercel.
  // Vite only exposes VITE_-prefixed vars to import.meta.env, so load the rest
  // into process.env for the dev-server side.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [
      shortenCriticalPath(),
      precacheServiceWorker(),
      devApiPlugin(),
      react(),
    ],
    resolve: {
      tsconfigPaths: true,
    },
    build: {
      rollupOptions: {
        output: {
          // React/TanStack change far less often than the app's own route and
          // component code, so isolating them lets browsers cache them across
          // deploys instead of re-downloading the framework on every release.
          // `motion`, `lucide-react` and `sonner` are used on the very first
          // paint (the action sheet, header icons, the toaster) so they still
          // belong in the eager path — this only changes which file they ship
          // in, not when they load. Rolldown (Vite 8's bundler) only accepts
          // the function form of manualChunks, not the object shorthand.
          manualChunks(id) {
            if (id.includes("node_modules")) {
              if (/[\\/]node_modules[\\/](react|react-dom)[\\/]/.test(id)) {
                return "vendor-react";
              }
              // react-query only. The router is gone (src/lib/useSearch.ts
              // replaced it) and react-store was never imported at all.
              if (/[\\/]node_modules[\\/]@tanstack[\\/]react-query[\\/]/.test(id)) {
                return "vendor-tanstack";
              }
              // No `vendor-motion` rule any more, deliberately. Naming a
              // manual chunk forces every motion module into one chunk that
              // the entry imports statically — which is exactly what
              // `<LazyMotion>` exists to avoid. Left to itself the bundler
              // splits on the `import()` in App.tsx and the animation runtime
              // lands in its own async chunk, off the critical path.
              if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
                return "vendor-ui";
              }
            }
          },
        },
      },
    },
  };
});
