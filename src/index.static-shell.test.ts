import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guards the hand-written shell in index.html against drifting away from the
 * app it is standing in for.
 *
 * That shell is the first thing anyone sees, and it is the one piece of markup
 * in the project that cannot import what it mirrors. It has already gone
 * stale once: the header kept using `header-top` / `header-title-row` /
 * `header-title` / `date-row` / `date-text` after the real header was
 * redesigned around `hero-inline`, so for the whole window between first paint
 * and React's first commit the page showed two lines of unstyled
 * browser-default text. Nothing failed — not the build, not the types, not the
 * tests — because unstyled HTML is still valid HTML.
 *
 * These tests are the missing failure.
 */

const repoRoot = new URL("../", import.meta.url);
const read = (rel: string) => fs.readFileSync(new URL(rel, repoRoot), "utf8");

const indexHtml = read("index.html");

/** The static shell only — everything inside <div id="root">. */
const shell = (() => {
  const start = indexHtml.indexOf('<div id="root">');
  assert.ok(start >= 0, 'index.html must contain <div id="root">');
  return indexHtml.slice(start);
})();

/** Class names the shell actually uses, ignoring the explanatory comments. */
const shellClasses = (() => {
  const withoutComments = shell.replace(/<!--[\s\S]*?-->/g, " ");
  const names = new Set<string>();
  for (const match of withoutComments.matchAll(/\sclass="([^"]+)"/g)) {
    for (const name of match[1].split(/\s+/)) if (name) names.add(name);
  }
  return names;
})();

/** Every class name that has at least one rule anywhere in src/styles. */
const styledClasses = (() => {
  const dir = new URL("src/styles/", repoRoot);
  const names = new Set<string>();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".css")) continue;
    const css = fs.readFileSync(new URL(file, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const match of css.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) names.add(match[1]);
  }
  return names;
})();

/**
 * Classes that carry no styling of their own and are not supposed to.
 *
 * Keep this list short and justified. Every entry is a class the test would
 * otherwise flag, so an unexplained addition here is how the next flash gets
 * waved through.
 */
const UNSTYLED_BY_DESIGN = new Set([
  // DaySelector emits `day-bar-${mode}` as a state hook. Only the two weekend
  // modes are styled (globals.css:1832-1839); the weekday one exists so the
  // banner and pill rules have something to *not* match.
  "day-bar-weekday-current",
]);

test("the static shell uses no class the stylesheets do not define", () => {
  assert.ok(shellClasses.size > 10, `only found ${shellClasses.size} classes — did the shell move?`);
  assert.ok(styledClasses.size > 100, `only found ${styledClasses.size} CSS classes — did src/styles move?`);

  const unstyled = [...shellClasses]
    .filter((c) => !styledClasses.has(c) && !UNSTYLED_BY_DESIGN.has(c))
    .sort();
  assert.deepEqual(
    unstyled,
    [],
    `index.html paints ${unstyled.length} class(es) with no rule in src/styles, so they render ` +
      `as unstyled browser defaults until React mounts: ${unstyled.join(", ")}`
  );
});

test("the shell reproduces the header the app actually renders", () => {
  // The specific drift that caused the flash. AppHeader is the source of
  // truth; if it stops using these, this test should be updated with it.
  const appHeader = read("src/components/AppHeader.tsx");
  for (const cls of ["app-header", "hero-inline", "hero-title", "hero-subtitle", "header-actions"]) {
    assert.ok(appHeader.includes(`"${cls}"`), `AppHeader no longer uses .${cls}`);
    assert.ok(shellClasses.has(cls), `the static shell is missing .${cls}`);
  }
});

test("the shell reserves a slot for every header button", () => {
  const appHeader = read("src/components/AppHeader.tsx");
  const rendered = appHeader.match(/className="info-btn"/g)?.length ?? 0;
  const reserved = shell.match(/class="info-btn"/g)?.length ?? 0;
  assert.ok(rendered > 0, "AppHeader renders no .info-btn — has it been restructured?");
  assert.equal(
    reserved,
    rendered,
    "the header box must be the same size before and after mount, or every card below it moves"
  );
});

test("the skeleton row sits inside a .cards-track in both shells", () => {
  // Every sizing rule for .cards-animated-wrapper is scoped as
  // `.cards-track > .cards-animated-wrapper`. Outside a track the wrapper
  // falls back to `gap: inherit` / `flex-direction: inherit`, which is no gap
  // on desktop and no height on mobile — the card jump this whole shell
  // exists to avoid.
  assert.ok(shellClasses.has("cards-track"), "index.html renders .cards-animated-wrapper bare");
  assert.ok(
    read("src/components/LoadingScreen.tsx").includes('"cards-track"'),
    "LoadingScreen renders .cards-animated-wrapper bare"
  );
});

test("the static skeleton card matches SkeletonCard row for row", () => {
  const skeleton = read("src/components/SkeletonCard.tsx");
  const perCard = (source: string, cls: string, cards: number) => {
    const total = source.match(new RegExp(`class(?:Name)?="${cls}"`, "g"))?.length ?? 0;
    return total / cards;
  };

  const staticCards = shell.match(/class="food-card skeleton-card"/g)?.length ?? 0;
  assert.equal(staticCards, 3, "one placeholder per canteen, and there have always been three");

  for (const cls of ["side-dish-item", "skeleton-line-chip"]) {
    assert.equal(
      perCard(shell, cls, staticCards),
      perCard(skeleton, cls, 1),
      `a static card has a different number of .${cls} rows than SkeletonCard, so the cards ` +
        `change height the moment React commits`
    );
  }
});

test("the shell carries no date-dependent text", () => {
  // The weekday, the week number and the dates in the strip all come from
  // computeDisplayContext. A second, vanilla copy of that logic in index.html
  // is exactly what that function exists to prevent — and it would be wrong on
  // weekends, on ?day=/?week= links, and twice a year at the DST boundary.
  const withoutComments = shell.replace(/<!--[\s\S]*?-->/g, " ");
  for (const weekday of ["Lørdag", "Søndag"]) {
    assert.ok(!withoutComments.includes(weekday), `the shell hardcodes "${weekday}"`);
  }
  assert.ok(
    !/new Date\(|Intl\.DateTimeFormat/.test(withoutComments),
    "the shell computes a date itself instead of leaving it to computeDisplayContext"
  );
});

test("index.html is the shell that ships", () => {
  // dist/ is a local build artifact and gitignored; editing it fixes nothing.
  const gitignore = read(".gitignore");
  assert.ok(/^\/?dist\/?$/m.test(gitignore), "dist is no longer gitignored — this test's premise moved");
  assert.ok(!fs.existsSync(path.join(repoRoot.pathname.replace(/^\//, ""), "public", "index.html")));
});

test("the shell cannot be painted without its stylesheet", () => {
  // The dev server has no <link rel="stylesheet"> at all — Vite serves CSS
  // through JS — so the shell would otherwise flash as browser-default markup
  // on every reload there. index.html hides #root; globals.css reveals it. The
  // pair makes "visible" and "styled" the same condition.
  assert.match(
    indexHtml,
    /#root\s*\{\s*visibility:\s*hidden/,
    "index.html no longer hides #root, so the shell can paint unstyled"
  );
  assert.match(
    read("src/styles/globals.css"),
    /#root\s*\{\s*visibility:\s*visible/,
    "globals.css no longer reveals #root, so the app would never become visible"
  );

  // Second, independent gate: an inline style attribute outranks every
  // stylesheet, so the shell stays hidden even if the <style> block never
  // applies. Both shell roots must carry it, and only an !important rule can
  // lift it.
  const shellRoots = shell.match(/data-shell style="visibility: hidden"/g) ?? [];
  assert.equal(shellRoots.length, 2, "both shell roots must be inline-hidden");
  assert.match(
    read("src/styles/globals.css"),
    /\[data-shell\]\s*\{\s*visibility:\s*visible\s*!important/,
    "nothing lifts the inline hide, so the shell would never appear"
  );
  assert.ok(
    !read("src/components/LoadingScreen.tsx").includes("data-shell"),
    "data-shell belongs to the static shell only — React's markup must never carry it"
  );
});

test("the tab is not renamed a moment after it opens", () => {
  // __root.tsx replaces the document title on mount. A different string in
  // index.html means the tab visibly relabels itself once React boots.
  const staticTitle = indexHtml.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
  const routeTitle = read("src/routes/__root.tsx").match(/\{\s*title:\s*"([^"]+)"/)?.[1]?.trim();
  assert.ok(staticTitle, "index.html has no <title>");
  assert.ok(routeTitle, "__root.tsx no longer sets a title — drop this test with it");
  assert.equal(staticTitle, routeTitle);
});
