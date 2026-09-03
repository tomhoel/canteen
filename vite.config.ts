import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerResponse } from "node:http";

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
