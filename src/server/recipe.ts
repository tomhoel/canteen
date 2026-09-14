import type { Recipe } from "../lib/types.js";
import { getWeekNumber } from "../lib/dateUtils.js";
import { getRedis, matchesCachedShape } from "./services/redis.service.js";

export interface RecipeRequest {
  dishName: string;
  lang: "no" | "en";
}

/** What a cached recipe must still have to be usable — the fields the sheet renders. */
const RECIPE_CACHE_FIELDS = ["title", "ingredients", "steps"] as const;

export async function generateRecipe(data: RecipeRequest) {
  const { dishName, lang } = data;

  if (!dishName || !["no", "en"].includes(lang)) {
    throw new Error("Invalid request");
  }

  const weekNum = getWeekNumber();
  const cacheKey = `recipe:wk${weekNum}:${dishName}:${lang}`;
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      // Shape-checked: a seven-day TTL is a long time to serve a recipe that
      // is missing whatever the current UI reads off it.
      if (matchesCachedShape<Recipe>(cached, RECIPE_CACHE_FIELDS)) return cached;
    } catch (err) {
      console.error("Redis read error:", err);
    }
  }

  // Imported here rather than at module scope: ai.service.ts pulls in
  // @google/genai (14 MB), and a recipe served from the 7-day cache above never
  // needs it. Paying that on the miss path only keeps it off every cache hit's
  // cold start.
  const { generateAIRecipe } = await import("./services/ai.service.js");
  const recipe = await generateAIRecipe(dishName, lang);

  if (redis) {
    try {
      await redis.set(cacheKey, recipe, { ex: 7 * 24 * 60 * 60 });
    } catch (err) {
      console.error("Redis write error:", err);
    }
  }

  return recipe;
}
