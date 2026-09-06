import WebSocket from "ws";
if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import fs from "node:fs";
import path from "node:path";
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
 * 2. `routes-*.js` holds HomeClient and FoodCard and is reached by a dynamic
 *    import the preload scanner cannot see. It began downloading only after
 *    ~456 KB of raw JS had been parsed and executed: a second, serialized
 *    network wave for the chunk that actually draws the cards.
 *
 * 3. ~17 KB of explanatory comments sat in front of all of it. They are worth
 *    keeping in source and worth nothing to a browser.
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
      handler(html, ctx) {
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

        // Make the route chunk discoverable. Both `routes-*` chunks are
        // preloaded rather than just the big one: there are only two, the
        // second is ~500 bytes gzipped, and picking by name is more robust
        // than guessing which facade id the router's code-splitter produced.
        const routeChunks = Object.keys(ctx.bundle ?? {}).filter((f) =>
          /^assets\/routes-[^/]+\.js$/.test(f)
        );
        if (routeChunks.length) {
          const tags = routeChunks
            .map((f) => `    <link rel="modulepreload" crossorigin href="/${f}">`)
            .join("\n");
          out = out.replace("</head>", `${tags}\n  </head>`);
        }

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

export default defineConfig(({ mode }) => {
  // The api/ handlers read plain process.env, exactly as they will on Vercel.
  // Vite only exposes VITE_-prefixed vars to import.meta.env, so load the rest
  // into process.env for the dev-server side.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ""));

  return {
    plugins: [
      shortenCriticalPath(),
      devApiPlugin(),
      TanStackRouterVite({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
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
              if (/[\\/]node_modules[\\/]@tanstack[\\/](react-router|react-query|react-store)[\\/]/.test(id)) {
                return "vendor-tanstack";
              }
              if (/[\\/]node_modules[\\/]motion[\\/]/.test(id)) {
                return "vendor-motion";
              }
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
