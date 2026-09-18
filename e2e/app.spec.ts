import { test, expect, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
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

  const infoBtn = page.locator('button[aria-label="Om appen"]');
  const isDesktop = await infoBtn.isVisible();
  let overlaySelector: string;

  if (isDesktop) {
    await infoBtn.click();
    await page.waitForSelector(".info-modal");
    overlaySelector = ".info-modal";
  } else {
    await page.locator(".food-card").first().click();
    await page.waitForSelector(".action-sheet");
    overlaySelector = ".action-sheet";
  }

  const state = await page.evaluate((sel) => {
    const wrapper = document.querySelector(".app-wrapper")!;
    const modal = document.querySelector(sel)!;
    const focusables = [...modal.querySelectorAll("button, a[href]")];
    const reachable = focusables.filter((el) => {
      (el as HTMLElement).focus();
      return document.activeElement === el;
    });
    const behind = [...document.querySelectorAll(".app-wrapper button, .app-header button")].filter((el) => {
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
  }, overlaySelector);

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
 * The budget above is blind to lazy chunks, and one of them is not really lazy
 * in the way that matters: the sheet chunk downloads and parses at the exact
 * moment the user taps a card and is waiting for something to happen. It is the
 * one piece of deferred work that happens under the user's eye.
 *
 * It was 9,974 bytes gzipped, of which `@use-gesture/react` was 6,489 — 65% of
 * it, for a drag-to-dismiss that nothing else in the app used. Replacing it with
 * raw touch listeners took it to 3,676. Without an assertion here, that saving
 * is invisible to CI and the next dependency lands in it unnoticed.
 */
test("the sheet chunk stays small, because it loads while the user waits", () => {
  const dir = join(DIST, "assets");
  const chunk = readdirSync(dir).find((f) => /^ActionSheet-.*\.js$/.test(f));
  expect(chunk, "no ActionSheet chunk in dist — did the lazy boundary move?").toBeTruthy();

  const gz = gzipSync(readFileSync(join(dir, chunk!))).length;
  // Headroom over the 3,676 bytes it is today, well under the 9,974 it was.
  expect(gz, `the sheet chunk is ${gz} bytes gzipped`).toBeLessThan(5_000);
});

/**
 * The Android back gesture must close an open overlay, not leave the app.
 *
 * `manifest.json` declares `display: "standalone"`, so on an installed phone
 * there is no browser chrome and the system back gesture is the only back
 * affordance there is. Nothing in `src/` touched history or close requests, so
 * back exited the whole app from inside an open overlay.
 *
 * A real back gesture cannot be synthesised, but a close request can: Escape IS
 * a close request, and where `CloseWatcher` exists the platform delivers both
 * through the same channel. So Escape here exercises the exact path back takes.
 *
 * The overlay under test is deliberately the INFO MODAL and not the sheet. The
 * sheet, the lightbox and the leaderboard each carry their own keydown listener,
 * so they close on Escape whether or not a watcher exists — a test against one
 * of those passes with the wiring torn out, which is exactly what the first
 * draft of this test did. The info modal is closed only by HomeClient's chain,
 * and since Escape is now handed to the watcher wherever one exists, removing
 * the watcher leaves nothing at all to close it. Mutation-checked both ways.
 */
test("a platform close request closes the overlay instead of the app", async ({ page }) => {
  await page.goto("/");
  await loaded(page);

  const supported = await page.evaluate(
    () => typeof (window as unknown as { CloseWatcher?: unknown }).CloseWatcher === "function"
  );
  test.skip(!supported, "no CloseWatcher here — iOS keeps the plain Escape path");

  const infoBtn = page.locator('button[aria-label="Om appen"]');
  const isDesktop = await infoBtn.isVisible();
  let overlaySelector: string;

  if (isDesktop) {
    await infoBtn.click();
    await page.waitForSelector(".info-modal");
    overlaySelector = ".info-modal";
  } else {
    await page.locator(".food-card").first().click();
    await page.waitForSelector(".action-sheet");
    overlaySelector = ".action-sheet";
  }

  await page.keyboard.press("Escape"); // the same close request the back gesture raises
  await page.waitForTimeout(600);

  await expect(
    page.locator(overlaySelector),
    "the close request never reached the app — on a phone, back would have exited it"
  ).toHaveCount(0);

  // ...and the app behind it is alive, i.e. the request closed a layer rather
  // than tearing anything else down.
  await expect(page.locator(".food-card").first()).toBeVisible();
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

/**
 * The close animation has to survive a DRAG, not just a tap.
 *
 * The test above taps the scrim on a sheet nobody touched, and that path was
 * fixed first. But `endDrag` clears the inline transition when any gesture
 * ends, and React does not write it back — it only emits an inline style whose
 * value changed, and that string is a module constant. With no stylesheet rule
 * underneath, one drag left the panel with `computed: "all / 0s"` forever
 * after: releasing without dismissing teleported it back, and the next close
 * jumped 443px in a single frame. That is most of what "it does not move
 * smoothly" meant, and the tap-only test could never see it.
 *
 * Measured on a phone before the fix: 0 -> 443 -> 443 -> ... -> GONE.
 * After: 4 -> 98 -> 303 -> 389 -> 427 -> 443 -> GONE.
 */
test("the sheet still animates its close AFTER it has been dragged", async ({ page }) => {
  test.skip(test.info().project.name === "desktop", "drag-to-dismiss is touch-only");
  await page.goto("/");
  await loaded(page);

  await page.locator(".food-card").first().click();
  await page.waitForSelector(".action-sheet");
  await page.waitForTimeout(600);

  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator(".native-sheet-panel").boundingBox())!;
  const x = box.x + box.width / 2;
  const y0 = box.y + 24;

  // A short pull down — well under the 25% dismiss threshold — then release.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let d = 8; d <= 40; d += 8) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + d }] });
    await page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);

  // The panel must still HAVE a transition. This is the direct assertion.
  const duration = await page.evaluate(
    () => getComputedStyle(document.querySelector(".native-sheet-panel")!).transitionDuration
  );
  expect(duration, "the drag cleared the panel transition and nothing restored it").not.toMatch(
    /^0s/
  );

  // ...and the close it feeds must still be gradual.
  const offsets = await page.evaluate(async () => {
    const wait = (ms: number) => new Promise((k) => setTimeout(k, ms));
    const panel = document.querySelector(".action-sheet") as HTMLElement;
    (panel.previousElementSibling as HTMLElement)?.click();
    const seen: number[] = [];
    for (let i = 0; i < 10; i++) {
      const el = document.querySelector(".native-sheet-panel") as HTMLElement | null;
      if (el) seen.push(Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42));
      await wait(40);
    }
    return seen;
  });

  const distinct = new Set(offsets).size;
  expect(
    distinct,
    `panel snapped through only ${distinct} positions (${offsets.join(", ")}) — it teleported`
  ).toBeGreaterThan(3);
});

/**
 * A hard flick UPWARD must cancel the drag, not dismiss the sheet.
 *
 * `@use-gesture` derives velocity from `_delta.map(Math.abs)`, so `vy` is a
 * magnitude with no sign; the sign lives in `direction`, which the sheet never
 * read. The threshold `vy > 0.5` therefore fired identically in both
 * directions, and the universal "no, put it back" gesture closed the sheet.
 * Reproduced in a browser before the fix.
 */
test("flicking the sheet upward cancels the drag instead of dismissing it", async ({ page }) => {
  test.skip(test.info().project.name === "desktop", "drag-to-dismiss is touch-only");
  await page.goto("/");
  await loaded(page);

  await page.locator(".food-card").first().click();
  await page.waitForSelector(".action-sheet");
  await page.waitForTimeout(600);

  const cdp = await page.context().newCDPSession(page);
  const box = (await page.locator(".native-sheet-panel").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + 40;

  // Engage downward (engagement latches), then flick sharply back up and lift.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const d of [10, 20, 25]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + d }] });
    await page.waitForTimeout(24);
  }
  for (const d of [0, -25, -50]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + d }] });
    await page.waitForTimeout(8);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(700);

  await expect(
    page.locator(".action-sheet"),
    "an upward flick dismissed the sheet — vy is unsigned, so the direction guard is missing"
  ).toHaveCount(1);
});
