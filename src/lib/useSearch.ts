import { useSyncExternalStore } from "react";

/**
 * The app's entire URL surface, without a router.
 *
 * @tanstack/react-router cost 23 KB gzipped on the critical path to provide
 * exactly this: read `?day=` and `?week=`, and write `?day=` back. There is one
 * screen, no `<Link>`, no route params and no second route, so the router was
 * paying for a routing tree the app never had.
 *
 * The route's `validateSearch` also declared `canteen`, `tab` and `q`. Nothing
 * in `src/` reads any of them. They are left untouched in the URL — `set` below
 * rewrites one key rather than rebuilding the query string — they are simply
 * not parsed.
 */
export type Search = { day?: string; week?: string };

const listeners = new Set<() => void>();

/**
 * Read once and cached, because `useSyncExternalStore`'s snapshot must be
 * referentially stable between renders or React re-renders forever.
 * `typeof window` guards module evaluation under `node --test`.
 */
let searchString = typeof window === "undefined" ? "" : window.location.search;

function emit() {
  searchString = window.location.search;
  for (const l of listeners) l();
}

if (typeof window !== "undefined") {
  // Back/forward, and anything else that changes the URL out from under us.
  window.addEventListener("popstate", emit);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/**
 * One parsed object per URL.
 *
 * Load-bearing: HomeClient feeds `searchParams.week` into a `useMemo` dependency
 * list (computeDisplayContext) and `searchParams?.day` into an effect. A fresh
 * object each render would re-run both on every unrelated re-render. The router
 * returned a stable object per location; so does this.
 */
let parsedFor: string | null = null;
let parsed: Search = {};

function parse(qs: string): Search {
  if (parsedFor !== qs) {
    const p = new URLSearchParams(qs);
    const out: Search = {};
    const day = p.get("day");
    const week = p.get("week");
    if (day !== null) out.day = day;
    if (week !== null) out.week = week;
    parsed = out;
    parsedFor = qs;
  }
  return parsed;
}

/** Replaces `useSearch({ strict: false })`. */
export function useSearch(): Search {
  return parse(useSyncExternalStore(subscribe, () => searchString, () => ""));
}

/**
 * Replaces the single `navigate({ search, replace: true })` call.
 *
 * `replaceState`, not `pushState`, deliberately — matching what the router was
 * asked for. Tapping through the weekdays must not stack history entries, or
 * Back walks Friday -> Thursday -> Wednesday instead of leaving the app, which
 * on an installed PWA is the difference between closing it and appearing to
 * freeze.
 */
export function setSearchParam(key: string, value: string) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(key) === value) return;
  url.searchParams.set(key, value);
  window.history.replaceState(window.history.state, "", url);
  emit();
}
