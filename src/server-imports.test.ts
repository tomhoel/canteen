import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Every relative import reachable from an `api/` function must end in `.js`.
 *
 * Node's ESM resolver requires the extension at runtime on Vercel. Omit it and
 * the build, the types, the unit tests and the client bundle (Vite resolves
 * extensionless imports) all stay green while every function that loads the
 * module dies at invocation with ERR_MODULE_NOT_FOUND. That is exactly how
 * `import "./dish-course-overrides"` took /api/menu and the cron down on
 * 2026-10-01: nothing failed anywhere until a request arrived.
 *
 * This walks the same graph the functions load, starting at api/*.ts and
 * following each relative specifier to its .ts source.
 */
const root = path.resolve(import.meta.dirname, "..");

function relativeSpecifiers(source: string): string[] {
  const out: string[] = [];
  // from "x", bare import "x", and dynamic import("x") — but not `import type`.
  const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^"'\n;]*?from\s+["'](\.[^"']+)["']|(?:^|\n)\s*import\s+["'](\.[^"']+)["']|\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const m of source.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function walk(entry: string, seen: Map<string, string[]>) {
  if (seen.has(entry)) return;
  const bad: string[] = [];
  seen.set(entry, bad);
  const source = fs.readFileSync(entry, "utf8");
  for (const spec of relativeSpecifiers(source)) {
    if (!spec.endsWith(".js")) {
      bad.push(spec);
      continue;
    }
    const target = path.resolve(path.dirname(entry), spec.replace(/\.js$/, ".ts"));
    if (fs.existsSync(target)) walk(target, seen);
  }
}

test("every relative import under api/ and what it loads ends in .js", () => {
  const entries: string[] = [];
  const collect = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) collect(full);
      else if (f.name.endsWith(".ts")) entries.push(full);
    }
  };
  collect(path.join(root, "api"));
  assert.ok(entries.length > 5, "found the api functions");

  const seen = new Map<string, string[]>();
  for (const entry of entries) walk(entry, seen);

  const offenders = [...seen].filter(([, bad]) => bad.length).map(([file, bad]) => `${path.relative(root, file)}: ${bad.join(", ")}`);
  assert.deepEqual(offenders, [], "these would crash the serverless function at invocation");
  assert.ok(seen.size > 15, `walked ${seen.size} files`);
});
