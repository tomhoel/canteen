# design-sync notes — canteen

Project: **Canteen** — https://claude.ai/design/p/784d23ef-ebb6-4dbb-8f97-87066533165b

## This repo is an app, not a library

`package.json` is `{name, private}` — no `main`, `module`, `exports` or `types`,
and `dist/` is the built *application*. Consequences, all already handled in
`config.json`:

- **There is no build command to run.** `cfg.buildCmd` is deliberately unset.
  The converter bundles straight from source.
- **`cfg.entry` points at `.design-sync/ds-entry.ts`, a hand-written barrel.**
  Do not point it at `src/main.tsx`: `--entry` both locates the package root
  *and* becomes what gets bundled, so main.tsx bundled the app bootstrap — a
  module that exports nothing and drags in the router. `window.Canteen` came out
  empty and all 12 components failed the export gate. The barrel also exists
  because most components here are `export default`, and a synthesised
  `export * from` entry drops defaults silently.
  Bundle size is the tell: barrel 452 KB / 7 inlined packages, main.tsx
  1950 KB / 24.
- **`cfg.tsconfig` is required** so esbuild resolves the `@/…` path aliases the
  components import.
- **Every `.d.ts` came out as `[key: string]: unknown`** — there is no type tree
  to read. `cfg.dtsPropsFor` carries hand-written prop bodies for all 12,
  transcribed from source with their JSDoc. **This is the highest-value part of
  the sync**: it is the contract the design agent codes against. If a component's
  props change in `src/`, update `dtsPropsFor` or the agent will misuse it.

## Fixes that are load-bearing

- **`.design-sync/browser-process-shim.mjs`, via `cfg.extraEntries`.**
  `src/lib/constants.ts` and `@tanstack/react-start` read `process.env` at module
  scope. Vite statically replaces those in the real app (the shipped bundle has
  no bare `process`), but esbuild does not, so the bundle threw
  `ReferenceError: process is not defined` before `window.Canteen` was assigned.
  `extraEntries` are emitted *before* the main entry in the generated
  `.bundle-entry.mjs`, which is what makes the shim run first. It provides an
  **empty** env on purpose — both reads have fallbacks, and the file ships inside
  the bundle, so real values would be published to everyone.

- **`PreviewFrame` in the barrel, wired as `cfg.provider`.**
  `package-capture.mjs` pins the page clock with `page.clock.setFixedTime`, so
  Motion's frame loop never advances and every `initial={{opacity: 0}}` element
  stays frozen. The plate photographs were rendering at opacity 0 — it looked
  like broken images. `PreviewFrame` sets `MotionGlobalConfig.skipAnimations`
  inside the wrapper only, so designs built with the system keep their motion.
  Without it, expect blank plates and invisible chips again.

- **`cfg.extraFonts` → `.design-sync/fonts.css`.** The app declares its two
  Outfit faces inline in `index.html`, not in a stylesheet, so the CSS scrape
  found the family referenced with no `@font-face` and printed `[FONT_MISSING]`.
  If the faces in index.html change, mirror them there.

## Preview gotchas

- **Capture viewport is 900×700, so desktop CSS rules apply.** A phone-width
  preview frame clips anything sized for desktop — the day bar is 502px wide
  there and lost Monday and Friday in a 390px frame.
- **`DaySelector` is `position: fixed`.** Its preview wraps it in a div with
  `transform: translateZ(0)`, which makes that div the containing block. Without
  it the bar anchors to the page and every cell captures blank.
- **Remote images never arrive.** The plates and the closed-canteen cutlery are
  inlined as base64 in the previews. The URLs load fine in a browser — the
  capture simply screenshots first.
- **Viewport/override changes need a full `package-build.mjs`**, not
  `preview-rebuild.mjs`; the latter fails `[CONFIG_STALE]`.
- **A scoped `package-capture.mjs --force` prunes the other review sheets.** Run
  it unscoped before a grading pass or you will find sheets missing.

## Known render warns

Both triaged as legitimate; a warn NOT in this list is new and worth looking at.

- **`AppHeader` — `Loading` and `Weekday` render identically.** Deliberate.
  `actions` is omitted so the buttons render inert; the header must occupy the
  same box before and after the menu arrives, or every card below it moves.
- **`ClosedCard` — `Default` and `ThirdInRow` render near-identically.**
  `cardIdx` only drives the reveal cascade, which a static capture cannot show.

`Wrapper3D` deliberately ships **one** story: `maxRotation`, `translateZ` and
`perspective` only act during pointer movement, so extra configurations rendered
three identical cards. The props are documented in the contract instead.

## Re-sync risks

- **`dtsPropsFor` is a hand-maintained copy of the props.** It cannot detect
  drift. Any prop added, removed or retyped in `src/components/` silently leaves
  the uploaded contract stale. Check it whenever a component's signature moves.

  **`CanteenDayItem` is inlined in FOUR entries** — `FoodCard.data`,
  `ClosedCard.data`, `AllClosedCard.closedCanteens`, and
  `ClosedCanteensPill.closedCanteens`. A field added to that type in
  `src/lib/types.ts` has to be added to all four. The 2026-09-06 re-sync found
  three of them stale after `displayDishName` was added and only `FoodCard`
  updated. `ActionSheet` looks like a fifth but is not: it has its own
  `canteenName`/`dishName` scalars, not the item.

  A quick audit that catches this:
  `node -e "const c=require('./.design-sync/config.json');for(const[k,v]of
  Object.entries(c.dtsPropsFor))if(v.includes('mainDish?'))console.log(k,
  v.includes('<newField>'))"`

- **Mobile-only CSS does not move `renderHashes`.** Previews capture at
  900×700, so a change confined to `@media (max-width: 768px)` leaves every
  desktop render byte-identical. On 2026-09-06 a near-total rewrite of the
  phone card layout re-graded only 4 of 12 components — correct, not a missed
  diff. The change still ships: it rides in `_ds_bundle.css` under `styling`,
  which is a separate partition from verification. Verify it landed by
  grepping the built `_ds_bundle.css` for a rule you changed — and grep the
  UNMINIFIED form, because this bundle appends the raw `globals.css`, not
  Vite's minified output.

- **The project holds files this sync does not produce, and must not delete
  them.** As of 2026-09-06: `templates/home-screen/*` (a home-screen template
  and a 390×844 phone preview) and `github.md`, all authored on the Claude
  Design side, plus the app's own `_ds_manifest.json` and
  `_adherence.oxlintrc.json`. The atomic path is safe by construction — the
  writes globs never name `templates/`, and an anchored diff puts nothing in
  `deletePaths`. The danger is the no-anchor branch, which asks you to review
  `list_files` and hand-pick deletes: do not sweep those paths.

- **Claude Design can read the repo itself.** `github.md` in the project is
  written by that side and tracks upstream drift per file. It reached the same
  conclusion this skill does — a `globals.css` change "can only land via a
  `/design-sync` run", because `_ds_bundle.css` is read-only there. So the
  repo connection covers source and drift tracking; the compiled bundle,
  contracts and preview cards still only move through this sync.
- **Inlined base64 images go stale.** The plate photographs in
  `previews/FoodCard.tsx`, `ClosedCard.tsx` and `AllClosedCard.tsx` are copies of
  production assets at 340px. If the plates are regenerated they will not update
  here.
- **The component scope is a deliberate subset**, pinned in
  `cfg.componentSrcMap`. `HomeClient`, `LoadingScreen` and `LeaderboardModal` are
  excluded because they need router or react-query context; the feature views
  (`WeekOverview`, `Lightbox`, `DealsView`, `MenyView`) are excluded as
  compositions rather than building blocks. Adding any of them means providing
  their providers via `cfg.provider`.
- **Only chromium 1208 and 1234 are cached on this machine.** playwright 1.62.0
  pins 1234 and was installed into `.ds-sync/` with
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. A newer playwright pins a build that is
  not cached and fails with `Executable doesn't exist`.
- **The design system's tokens were only just introduced** (`src/styles/globals.css`,
  guarded by `src/styles/tokens.test.ts`). Call sites have NOT been migrated —
  spacing, radius and elevation are declared and adopted opportunistically, so
  components still carry their original literals. The uploaded system is honest
  about what exists, not what is fully adopted.
