import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

/**
 * Every assertion here corresponds to something that actually broke.
 *
 * The comment on each test says which. That is the bar for adding another one:
 * if it does not guard a bug that reached production or a property someone
 * deliberately tuned, it is not worth the maintenance.
 */

/**
 * A 1x1 PNG, standing in for every plate.
 *
 * The plates live on Supabase, so without this the suite would depend on a
 * third party being up and on the network being fast enough not to trip the
 * layout assertions. The cards do not care what the image contains — the slot
 * is a fixed size — only that one loads.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Records every CSS animation the page starts, before the page starts.
 *
 * `addInitScript` runs ahead of the app's own scripts, which is the only way to
 * see the entrance animations — by the time a test could call `evaluate`, they
 * have already been and gone. DOM sampling was tried first and gave the wrong
 * answer three times; listening to the events is what finally settled it.
 */
async function instrument(page: Page) {
  await page.route("**/storage/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG })
  );
  await page.addInitScript(() => {
    (window as unknown as { __anim: string[] }).__anim = [];
    document.addEventListener(
      "animationstart",
      (e) => (window as unknown as { __anim: string[] }).__anim.push((e as AnimationEvent).animationName),
      true
    );
  });
}

/** Waits for the real cards, not the skeletons the shell paints immediately. */
async function loaded(page: Page) {
  await page.waitForSelector(".food-card:not(.skeleton-card)", { timeout: 15_000 });
  await settled(page);
}

/**
 * Waits for the card cascade to finish.
 *
 * Not a sleep, and not optional. On desktop `cardReveal` animates
 * `scale(0.97) -> scale(1)` and FoodCard hands each card its own delay and
 * duration (0/55/110ms, 0.28/0.32/0.36s) — so mid-cascade the three cards are
 * at three different scales, and a height comparison taken then fails by a few
 * pixels for a layout that is perfectly correct. Measuring the settled state is
 * the only thing that means anything.
 *
 * Filtered to the entrance by name: the app also runs infinite decorative
 * animations (shimmer, gentleFloat, the gradient blobs) that never finish, so
 * waiting on `getAnimations()` wholesale would hang until the timeout.
 */
async function settled(page: Page) {
  await page.waitForFunction(
    () =>
      document
        .getAnimations()
        .filter((a) => /^cardReveal/.test((a as CSSAnimation).animationName ?? ""))
        .every((a) => a.playState === "finished"),
    undefined,
    { timeout: 5_000 }
  );
}

test.beforeEach(async ({ page }) => {
  await instrument(page);
});

/**
 * Guards the card layout, which was tuned by hand over a full day.
 *
 * The fixture deliberately gives the three canteens 3, 2 and 1 side dishes:
 * uneven content is what used to make the cards different heights, so a version
 * of this assertion against uniform input would pass while broken.
 */
test("the three cards are the same height and the page does not scroll", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  const heights = await page.$$eval(".food-card", (cards) =>
    cards.map((c) => Math.round(c.getBoundingClientRect().height))
  );

  expect(heights).toHaveLength(3);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

  const overflow = await page.$eval(".cards-container", (c) => c.scrollHeight - c.clientHeight);
  expect(overflow).toBe(0);
});

/**
 * Guards the fix for the reported "double entry animation".
 *
 * The same card is rendered three times on every load — index.html's static
 * shell, LoadingScreen's skeletons, then the real cards — and each generation
 * used to restart every entrance on it: cardReveal fired SEVEN times, and the
 * waves overlapped rather than handing off. Only the real cards animate now.
 */
test("the app enters exactly once", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  const counts = await page.evaluate(() => {
    const names = (window as unknown as { __anim: string[] }).__anim;
    return {
      cardReveal: names.filter((n) => n === "cardReveal" || n === "cardRevealFlat").length,
      // Desktop-only, and it must never come from a skeleton.
      cardContentEnter: names.filter((n) => n === "cardContentEnter").length,
      // Deleted outright: it fired twice, the second time on a bar already on
      // screen in its final position.
      dayBarRise: names.filter((n) => n === "dayBarRise").length,
    };
  });

  expect(counts.cardReveal).toBe(3);
  expect(counts.dayBarRise).toBe(0);
  // 3 on desktop (one per card), 0 on the phone where the rule does not apply.
  expect([0, 3]).toContain(counts.cardContentEnter);
});

/**
 * Guards the fix for every overlay being unusable in production.
 *
 * `useShellInert` marks `.app-wrapper` inert while an overlay is open, and all
 * of them except the action sheet used to render *inside* it — so the attribute
 * meant to protect the page behind the overlay took the overlay with it.
 * Measured before the fix: 0 of 3 focusable elements in the info panel could be
 * focused, and a click anywhere in it fell through to the scrim and dismissed
 * it. Both halves are asserted: the overlay works, and the page behind does not.
 */
test("an open overlay is usable and the page behind it is not", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  await page.click('button[aria-label="Om appen"]');
  await page.waitForSelector(".info-modal");

  const state = await page.evaluate(() => {
    const wrapper = document.querySelector(".app-wrapper")!;
    const modal = document.querySelector(".info-modal")!;
    const focusables = [...modal.querySelectorAll("button, a[href]")];
    const reachable = focusables.filter((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    const behind = [...document.querySelectorAll(".app-header button")].filter((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    return {
      wrapperInert: wrapper.hasAttribute("inert"),
      modalInsideWrapper: wrapper.contains(modal),
      focusable: focusables.length,
      reachable: reachable.length,
      behindReachable: behind.length,
    };
  });

  expect(state.wrapperInert).toBe(true);
  expect(state.modalInsideWrapper).toBe(false); // portalled out
  expect(state.focusable).toBeGreaterThan(0);
  expect(state.reachable).toBe(state.focusable);
  expect(state.behindReachable).toBe(0);
});

/**
 * Guards the hand-written day transition that replaced AnimatePresence.
 *
 * popLayout put both days on screen at once; the replacement stacks them in
 * `.cards-track`'s existing grid cell. The failure mode it is watching for is a
 * leaving panel that never unmounts — the exit is driven by a timer, because
 * neither `transitionend` nor a transform change is guaranteed to fire.
 */
test("a day change overlaps two panels and settles back to one", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  const before = await page.$$eval(".day-panel", (p) => p.length);
  expect(before).toBe(1);

  await page.click(".day-selector button:nth-of-type(4)");

  // Both days share the screen for the length of the change.
  await expect.poll(() => page.$$eval(".day-panel", (p) => p.length), { timeout: 2_000 }).toBe(2);
  // ...and the leaving one is gone afterwards.
  await expect.poll(() => page.$$eval(".day-panel", (p) => p.length), { timeout: 3_000 }).toBe(1);
  await settled(page);

  const heights = await page.$$eval(".food-card", (cards) =>
    cards.map((c) => Math.round(c.getBoundingClientRect().height))
  );
  expect(heights).toHaveLength(3);
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});

/**
 * Guards the critical path itself, in bytes.
 *
 * This session took eager JS from 149.6 KB gzipped to 91.8 KB, and every one of
 * those kilobytes is easy to hand back by accident — a static import of a
 * library that was meant to stay lazy costs nothing at the call site and is
 * invisible in review. The budget is what makes that cost visible.
 *
 * It reads the BUILT output rather than the import graph, because the graph is
 * what lies: `<LazyMotion>` is imported from "motion/react", so the wrapper
 * alone held ~10 KB of motion's core in the entry chunk while every component
 * using it was lazy and the code read as if nothing eager referenced it.
 *
 * An earlier version of this test watched network requests for a chunk with
 * "motion" in its name. It passed with motion statically bundled into the entry
 * — the exact regression it existed to catch — because a bundled library has no
 * URL of its own. Bytes are the only honest measure.
 *
 * Raise these deliberately and say why, the same as any other budget.
 */
test("the critical path stays within budget", async () => {
  const html = readFileSync(join(DIST, "index.html"), "utf8");
  const eager = [...new Set([...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)].map((m) => m[1]))];

  let js = 0;
  let css = 0;
  for (const asset of eager) {
    const gz = gzipSync(readFileSync(join(DIST, asset))).length;
    if (asset.endsWith(".js")) js += gz;
    else if (asset.endsWith(".css")) css += gz;
  }

  // Headroom over the 91.8 KB / 12.7 KB the build produces today: enough that
  // ordinary feature work does not trip it, tight enough that a library landing
  // on the critical path does.
  expect(js, `eager JS is ${js} bytes gzipped`).toBeLessThan(100_000);
  expect(css, `eager CSS is ${css} bytes gzipped`).toBeLessThan(16_000);
});

/**
 * Guards the sheet's close animation.
 *
 * `ui/sheet.tsx` has always had a two-phase close — drop `shown`, let the 400ms
 * transition run, then unmount — but HomeClient returned null the moment
 * `isOpen` went false, destroying the component on the same tick. The sheet
 * vanished instead of sliding down, which is what it was reported as.
 *
 * Asserted as "still mounted while it animates" rather than on translateY,
 * because the two breakpoints animate differently: a phone slides the panel up
 * from the bottom edge, a desktop scales a centred card that never translates.
 * Surviving its own close is the property both share, and the one that broke.
 *
 * Measured on a phone before the fix: 0 -> GONE in a single frame.
 * After: 0 -> 44 -> 233 -> 371 -> 434 -> 443 -> GONE.
 */
test("the sheet animates out when dismissed instead of vanishing", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  await page.locator(".food-card").first().click();
  await page.waitForSelector(".action-sheet");
  await page.waitForTimeout(600); // let it finish opening

  const frames = await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((k) => setTimeout(k, ms));
    const panel = document.querySelector(".action-sheet") as HTMLElement;
    (panel.previousElementSibling as HTMLElement)?.click(); // the scrim
    const present: boolean[] = [];
    for (let i = 0; i < 16; i++) {
      present.push(!!document.querySelector(".action-sheet"));
      await wait(40);
    }
    return present;
  });

  // An instant unmount gives [true, false, false, ...]. A 400ms exit keeps it
  // alive for roughly ten 40ms samples.
  const alive = frames.filter(Boolean).length;
  expect(alive, `panel survived only ${alive} frames — it is being unmounted, not animated`).toBeGreaterThan(4);
  // ...and it does eventually leave.
  expect(frames[frames.length - 1]).toBe(false);
});
