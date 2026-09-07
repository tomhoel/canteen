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
  status.clear();
}

type Settled =
  | { state: "pending" }
  | { state: "done"; value: WeeklyMenuResponse }
  | { state: "error"; error: unknown };

const status = new Map<string, Settled>();

/**
 * `use()`, written out.
 *
 * React 19's `use()` is the only React-19-only API this app has, and it is one
 * call site. This is the same thing in the form every Suspense implementation
 * has understood since the beginning: return the value if it has settled,
 * rethrow the error if it failed, and throw the promise itself if it has not
 * resolved yet. Suspense catches the throw and retries the render when the
 * promise settles.
 */
export function readMenu(week: string | undefined, epoch: number): WeeklyMenuResponse {
  const key = `${epoch}|${week ?? ""}`;
  const p = menuResource(week, epoch);
  const s = status.get(key);
  if (s?.state === "done") return s.value;
  if (s?.state === "error") throw s.error;
  if (!s) {
    status.set(key, { state: "pending" });
    p.then(
      (value) => status.set(key, { state: "done", value }),
      (error) => status.set(key, { state: "error", error })
    );
  }
  throw p;
}
