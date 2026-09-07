import { defineConfig, devices } from "@playwright/test";

/**
 * The tests `npm test` structurally cannot run.
 *
 * Everything in `src/**\/*.test.ts` is a pure function, a server module or a
 * stylesheet read as text — none of it renders the app. That gap is not
 * theoretical: aliasing React to preact/compat, an entire framework swap, left
 * all 289 of those tests green, and the three bugs fixed on 2026-09-07 (every
 * overlay inert, the app entering three times, a phantom "Allergener:" dish)
 * all reached production and were found by a person looking at the screen.
 *
 * These run against the real production build, in a real browser, and assert
 * the handful of invariants that were previously held in place by comments.
 *
 * Kept deliberately small. A browser test that fails for its own reasons is
 * worse than no test, because it teaches everyone to ignore a red run.
 */
export default defineConfig({
  testDir: "./e2e",
  // The suite is a few seconds of work; a slow one means something hung.
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "line",

  use: {
    baseURL: `http://localhost:${process.env.E2E_PORT ?? 4176}`,
    trace: "on-first-retry",
  },

  projects: [
    {
      // The platform that matters most, and the one every layout rule in the
      // mobile block is written for.
      name: "phone",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  // Build first, then serve dist.
  //
  // Port 4176, not vite preview's 4173, and `reuseExistingServer: false`. Both
  // are scars: a stale `vite preview` left on 4173 was silently adopted as the
  // server for a whole run, and every test failed against an app that could not
  // load its menu. A suite that quietly tests something else is worse than one
  // that refuses to start.
  webServer: {
    command: "npm run build && npx tsx e2e/server.ts",
    url: `http://localhost:${process.env.E2E_PORT ?? 4176}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
