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

const MENU_LOCAL_CACHE_PREFIX = "canteen_menu_cache_v2_";
const MENU_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface CachedWeeklyMenu {
  timestamp: number;
  week: string;
  data: WeeklyMenuResponse;
}

export function getCachedWeeklyMenu(week?: string): WeeklyMenuResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${MENU_LOCAL_CACHE_PREFIX}${week || "current"}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWeeklyMenu;
    if (
      parsed &&
      parsed.data &&
      parsed.data.menuData &&
      Date.now() - parsed.timestamp < MENU_CACHE_MAX_AGE_MS
    ) {
      return parsed.data;
    }
  } catch {
    /* ignore localStorage errors */
  }
  return null;
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
