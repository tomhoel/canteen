import { getWeeklyMenu, type WeeklyMenuResponse } from "@/lib/api-client";

/**
 * The route loader, without the router.
 *
 * Keyed by `week` and by a retry `epoch`, and memoised at module scope for one
 * reason that is easy to get wrong: `use()` may replay a suspended render any
 * number of times before the component ever commits, and state from an
 * uncommitted render is discarded. Creating the promise *during* render would
 * therefore start a new fetch on every replay — an infinite request loop that
 * looks like a hung app. The promise has to exist before render asks for it,
 * which is what this map is.
 *
 * `epoch` is what the error screen's "Prøv igjen" bumps. A new key means a new
 * promise means a new fetch, which is exactly what the router's `errorComponent`
 * `reset` did.
 */
const cache = new Map<string, Promise<WeeklyMenuResponse>>();

export function menuResource(week: string | undefined, epoch: number) {
  const key = `${epoch}|${week ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = getWeeklyMenu(week);
    // use() rethrows the rejection during render, where the boundary catches
    // it. This attached handler only stops the browser reporting an unhandled
    // rejection in the meantime; it does not swallow the error.
    p.catch(() => {});
    cache.set(key, p);
  }
  return p;
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function __resetMenuResource() {
  cache.clear();
}
