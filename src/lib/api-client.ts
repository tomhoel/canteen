import type {
  DealsResponse,
  MenyResponse,
  Recipe,
  RecipeIngredient,
  MenuData,
  DishOrigin,
  DishDescription,
} from "@/lib/types";

/**
 * Browser-side client for the /api functions.
 *
 * The app previously imported src/server/* directly into components. Because
 * the build is a client-only SPA, that shipped the scraper, the AI prompts and
 * every `process.env.*` lookup into the browser bundle — so each visitor
 * re-scraped all three canteens themselves, and none of the API-key-dependent
 * features could ever work. Everything now goes over HTTP to a function that
 * holds the secrets.
 */

export interface WeeklyMenuResponse {
  /** The week the server actually served — see the server-side type. */
  weekId: string;
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
  /**
   * Dish name -> a shortened headline for it. See the server-side type; the
   * full name is still what `menuData` carries and what the lightbox shows.
   */
  dishShortNames: Record<string, string>;
  /**
   * Storage path of each card's plate image, keyed `"<day>|<canteen name>"`.
   * The server resolves this because it knows which dish a stored plate depicts;
   * the browser cannot. A missing key means no picture exists for that day.
   */
  plateImages: Record<string, string>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    // Endpoints answer errors as {error}; fall back to the status if the body
    // is not JSON (a proxy error page, say).
    let message = `Request to ${path} failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep the status-based message */
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Bump the trailing version whenever `WeeklyMenuResponse` gains a field the UI
 * depends on.
 *
 * `getWeeklyMenu` is stale-while-revalidate: it returns the cached payload and
 * the fresh response only ever reaches `localStorage`, never React. So an entry
 * written by a previous deploy is what the whole session renders from — for up
 * to `MENU_CACHE_MAX_AGE_MS` — and on an installed PWA that is nearly every
 * launch.
 *
 * That is not hypothetical. `weekId` was added, deployed, and confirmed live on
 * the API, and returning users still got the pre-change payload: the weekend
 * header read "Uke 36 · Fredag 4. september" above week 37's food, which is the
 * exact contradiction `computeDisplayContext` exists to prevent. Bumping the
 * prefix retires every old-shape entry at once instead.
 */
const MENU_LOCAL_CACHE_PREFIX = "canteen_menu_cache_v5_";
const MENU_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fields a cached payload must carry to be usable.
 *
 * Belt and braces with the prefix above: this catches a shape change where the
 * prefix bump was forgotten, which is the likelier mistake of the two. A miss
 * costs one fetch; a false hit costs a wrong screen for six hours.
 */
const REQUIRED_CACHE_FIELDS = ["menuData", "weekId"] as const;

export interface CachedWeeklyMenu {
  timestamp: number;
  week: string;
  data: WeeklyMenuResponse;
}

/**
 * Whether a parsed cache entry may be served. Split out from the localStorage
 * plumbing so it can be tested without a DOM.
 */
export function isUsableCacheEntry(parsed: CachedWeeklyMenu | null, now: number): boolean {
  if (!parsed?.data) return false;

  // Both ends of the window. A negative age — a device whose clock has been
  // moved back, or a payload written by a device ahead of this one — is not
  // "extra fresh"; unbounded, it reads as valid forever.
  const age = now - parsed.timestamp;
  if (!(age >= 0 && age < MENU_CACHE_MAX_AGE_MS)) return false;

  // Truthiness, not `!= null`: an empty-string `weekId` reaches
  // computeDisplayContext as falsy and silently takes the fallback branch,
  // which is the bug this guard exists to stop, only harder to see.
  return REQUIRED_CACHE_FIELDS.every((f) => Boolean(parsed.data[f]));
}

export function getCachedWeeklyMenu(week?: string): WeeklyMenuResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${MENU_LOCAL_CACHE_PREFIX}${week || "current"}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWeeklyMenu;
    if (isUsableCacheEntry(parsed, Date.now())) {
      return parsed.data;
    }
  } catch {
    /* ignore localStorage errors */
  }
  return null;
}

/**
 * Drop menu entries left behind by an earlier cache version.
 *
 * A prefix bump makes the old entries unreachable, not absent — and a week's
 * payload is ~23 KB, which is real against a ~5 MB budget shared with the vote
 * and attendance state. Runs once per session, off the back of a write that has
 * already succeeded, so it never costs a launch anything.
 */
let sweptOldCaches = false;
function sweepSupersededMenuCaches() {
  if (sweptOldCaches) return;
  sweptOldCaches = true;
  try {
    const stale = Object.keys(localStorage).filter(
      (k) => k.startsWith("canteen_menu_cache_") && !k.startsWith(MENU_LOCAL_CACHE_PREFIX)
    );
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* a browser that refuses to enumerate storage is not worth failing over */
  }
}

export function setCachedWeeklyMenu(data: WeeklyMenuResponse, week?: string) {
  if (typeof window === "undefined" || !data?.menuData) return;
  try {
    const entry: CachedWeeklyMenu = {
      timestamp: Date.now(),
      week: week || "current",
      data,
    };
    localStorage.setItem(`${MENU_LOCAL_CACHE_PREFIX}${week || "current"}`, JSON.stringify(entry));
    sweepSupersededMenuCaches();
  } catch {
    /* ignore storage quota errors */
  }
}

export async function getWeeklyMenu(week?: string): Promise<WeeklyMenuResponse> {
  const query = week ? `?week=${encodeURIComponent(week)}` : "";
  const cached = getCachedWeeklyMenu(week);

  // If cached data is available, return it immediately for a 0ms instant initial paint.
  // Then revalidate in the background without blocking the UI.
  if (cached) {
    // The document head has already fired this exact request by the time we get
    // here. Issuing a second one meant two identical /api/menu round trips on
    // the single most common launch path there is — the installed PWA being
    // reopened with a warm cache — and the head's copy was simply dropped.
    //
    // Only when no week is pinned. The head fetch is an unqualified
    // `/api/menu`, so on a ?week= load it answers for the *current* week, and
    // reusing it here would write that answer under the pinned week's cache
    // key and serve the wrong week for the next six hours.
    const w = typeof window !== "undefined" ? (window as any) : undefined;
    let revalidation: Promise<WeeklyMenuResponse | null>;

    if (!week && w?.__MENU_FETCH_PROMISE__) {
      revalidation = w.__MENU_FETCH_PROMISE__;
      w.__MENU_FETCH_PROMISE__ = undefined;
    } else {
      revalidation = request<WeeklyMenuResponse>(`/api/menu${query}`);
    }

    revalidation
      .then((fresh) => {
        if (fresh?.menuData) {
          setCachedWeeklyMenu(fresh, week);
        }
      })
      .catch(() => {
        /* silent revalidation */
      });
    return cached;
  }

  // On initial cold visit without an explicit week param, reuse the eager fetch
  // initiated in the document <head> to avoid waiting for a whole second round-trip.
  if (!week && typeof window !== "undefined") {
    const w = window as any;
    if (w.__INITIAL_MENU_DATA__?.menuData) {
      const data = w.__INITIAL_MENU_DATA__;
      setCachedWeeklyMenu(data, week);
      return data;
    }
    if (w.__MENU_FETCH_PROMISE__) {
      try {
        const early = await w.__MENU_FETCH_PROMISE__;
        w.__MENU_FETCH_PROMISE__ = undefined;
        if (early?.menuData) {
          setCachedWeeklyMenu(early, week);
          return early;
        }
      } catch {
        /* fall through to standard request */
      }
    }
  }

  const fresh = await request<WeeklyMenuResponse>(`/api/menu${query}`);
  if (fresh?.menuData) {
    setCachedWeeklyMenu(fresh, week);
  }
  return fresh;
}

export function fetchDeals(payload: {
  ingredients: RecipeIngredient[];
  dishName: string;
  lang: "no" | "en";
}): Promise<DealsResponse> {
  return post<DealsResponse>("/api/deals", payload);
}

export function searchMeny(payload: {
  ingredients: RecipeIngredient[];
  dishName: string;
  lang: "no" | "en";
  storeId?: string;
}): Promise<MenyResponse> {
  return post<MenyResponse>("/api/meny", payload);
}

export function generateRecipe(payload: {
  dishName: string;
  lang: "no" | "en";
}): Promise<Recipe> {
  return post<Recipe>("/api/recipe", payload);
}

export function submitVote(payload: { canteenId: string }): Promise<{ canteens: Record<string, number> }> {
  return post("/api/attendance", payload);
}

/** One entry per day that saw at least one vote, newest first. */
export interface AttendanceHistoryEntry {
  date: string;
  canteens: Record<string, number>;
}

/**
 * The last fortnight of tallies.
 *
 * GET on the same endpoint that accepts the votes. The leaderboard used to
 * fetch `/api/attendance/history`, which is not a function that exists — and
 * because the SPA rewrite in vercel.json deliberately excludes `/api/`, that
 * path was never rewritten to index.html either. It answered a plain 404,
 * `.json()` threw, and the modal's catch left it showing its empty state.
 */
export function getAttendanceHistory(
  signal?: AbortSignal
): Promise<{ entries: AttendanceHistoryEntry[] }> {
  return request("/api/attendance", { signal });
}

export function sendSlackNotification(payload: {
  canteens: Record<string, number>;
  dishes: Record<string, string>;
  date: string;
  lang: "no" | "en";
}): Promise<{ skipped?: boolean }> {
  return post("/api/notify", payload);
}
