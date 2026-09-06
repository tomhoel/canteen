/**
 * The design system's entry point.
 *
 * This app has no library build — `package.json` is `{name, private}` and
 * `dist/` is the built application, not a component library. The converter's
 * `--entry` both locates the package root AND becomes what gets bundled, so
 * pointing it at `src/main.tsx` bundled the app *bootstrap*: a module that
 * exports nothing, mounts React to the DOM, and pulls in the router. Every
 * component then failed the export gate because `window.Canteen` was empty.
 *
 * This barrel is the entry instead. Two things it fixes beyond the obvious:
 *
 *  - Most components here are default exports, per this app's convention. A
 *    synthesised `export * from "<file>"` entry would drop every one of them,
 *    because `export *` does not re-export `default`. They are named here.
 *
 *  - It bounds the bundle to the design system. The app shell, the router, the
 *    lazy-loaded feature views and their data hooks are all out of the graph.
 *
 * Scope is the 11 reusable components chosen for the sync — the building
 * blocks a design agent composes new screens from. The feature views
 * (WeekOverview, Lightbox, DealsView, MenyView) and anything needing router or
 * query context (HomeClient, LoadingScreen, LeaderboardModal) are deliberately
 * absent; see componentSrcMap in config.json.
 */

/* Cards — the three states a canteen can be in, plus its loading placeholder. */
export { default as FoodCard } from "../src/components/FoodCard";
export { default as ClosedCard } from "../src/components/ClosedCard";
export { default as AllClosedCard } from "../src/components/AllClosedCard";
export { SkeletonCard } from "../src/components/SkeletonCard";

/* Navigation and chrome. */
export { default as AppHeader } from "../src/components/AppHeader";
export { default as DaySelector } from "../src/components/DaySelector";
export { default as ClosedCanteensPill } from "../src/components/ClosedCanteensPill";

/* Overlays. Sheet is the primitive; ActionSheet is the app's use of it. */
export { Sheet, SheetContent } from "../src/components/ui/sheet";
export { default as ActionSheet } from "../src/components/ActionSheet";

/* Input. */
export { PriceRanger } from "../src/components/PriceRanger";

/* The desktop-only 3D tilt wrapper. */
export { Wrapper3D } from "../src/components/ui/3d-wrapper";

/* ------------------------------------------------------------------------- */

import * as React from "react";
import { MotionGlobalConfig } from "motion/react";

/**
 * Wrapper for the preview cards. Not part of the component vocabulary — do not
 * build designs with it.
 *
 * Several components here animate themselves in: the plate is a `motion.img`
 * with `initial={{ opacity: 0 }}`, the card has a reveal cascade, the allergen
 * chips pop. The screenshot harness pins the page clock with
 * `page.clock.setFixedTime`, so Motion's frame loop never advances and every
 * one of those elements stays frozen at its `initial` value — the plate
 * photographs were rendering at opacity 0, which read as "the images are
 * broken" rather than "the animation has not started".
 *
 * `skipAnimations` completes every animation immediately, so a card is
 * captured in the state a user sees a moment after it appears. It is set here,
 * inside the preview wrapper, rather than at module scope: a design built with
 * this system should keep its motion.
 */
export function PreviewFrame({ children }: { children: React.ReactNode }) {
  MotionGlobalConfig.skipAnimations = true;
  return React.createElement(React.Fragment, null, children);
}
