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
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
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

export function getWeeklyMenu(week?: string): Promise<WeeklyMenuResponse> {
  const query = week ? `?week=${encodeURIComponent(week)}` : "";
  return request<WeeklyMenuResponse>(`/api/menu${query}`);
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

export function sendSlackNotification(payload: {
  canteens: Record<string, number>;
  dishes: Record<string, string>;
  date: string;
  lang: "no" | "en";
}): Promise<{ skipped?: boolean }> {
  return post("/api/notify", payload);
}
