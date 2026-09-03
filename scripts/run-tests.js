import { spawnSync } from "node:child_process";
import fs from "node:fs";

function findTests(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist") {
      results = results.concat(findTests(full));
    } else if (entry.isFile() && (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.js"))) {
      results.push(full);
    }
  }
  return results;
}

const files = [
  ...findTests("src"),
  ...fs.readdirSync(".").filter((f) => f.endsWith(".test.js") || f.endsWith(".test.ts")),
];

const res = spawnSync(
  process.execPath,
  ["--experimental-test-module-mocks", "--import", "tsx", "--test", ...files],
  { stdio: "inherit" }
);

process.exit(res.status ?? 1);
