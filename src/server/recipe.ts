import { generateAIRecipe } from "./services/ai.service.js";
import { getWeekNumber } from "../lib/dateUtils.js";
import { Redis } from "@upstash/redis";

function getRedis() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return null;
}

export interface RecipeRequest {
  dishName: string;
  lang: "no" | "en";
}

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
      if (cached) return cached;
    } catch (err) {
      console.error("Redis read error:", err);
    }
  }

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
