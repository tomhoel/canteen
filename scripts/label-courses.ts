// One-off: give every dish in the stored weeks a course label.
// New dishes get theirs from the updater; this covers what predates it.
// Idempotent: only dishes without a stored label are sent to the model.
// Usage: node --env-file=.env --import tsx scripts/label-courses.ts [out.json]
import fs from "node:fs";
import { getRedis } from "../src/server/services/redis.service.js";
import { classifyCourses } from "../src/server/services/ai.service.js";
import {
  loadDishCache,
  saveDishCacheEntries,
  normalizeDishName,
} from "../src/server/services/dish-cache.service.js";
import type { DishCourse } from "../src/lib/types.js";

const out = process.argv[2];
const redis = getRedis();
if (!redis) throw new Error("Redis is not configured");

const weeks = await redis.zrange("menu:weeks", 0, -1);
const dishes = new Set<string>();
for (const w of weeks) {
  const rec = await redis.get<any>(`menu:${w}`);
  for (const c of Object.values<any>(rec?.menuData?.canteens ?? {}))
    for (const d of c.menu ?? [])
      for (const lang of ["no", "en"])
        for (const it of d[lang]?.items ?? []) if (it.dish?.trim()) dishes.add(it.dish);
}
console.log(`${weeks.length} weeks, ${dishes.size} distinct dishes`);

const { rows } = await loadDishCache([...dishes]);
const labels: Record<string, DishCourse> = {};
const missing: string[] = [];
for (const dish of dishes) {
  const have = rows.get(normalizeDishName(dish))?.course;
  if (have) labels[dish] = have;
  else missing.push(dish);
}
console.log(`${Object.keys(labels).length} already labelled, ${missing.length} to ask about`);

const fresh = await classifyCourses(missing);
Object.assign(labels, fresh);
console.log(`model labelled ${Object.keys(fresh).length} of ${missing.length}`);

// Only rows that already exist: a bare row for a dish the updater has never
// enriched would look like work to do.
const entries = Object.entries(fresh)
  .filter(([dish]) => rows.has(normalizeDishName(dish)))
  .map(([dish, course]) => ({ cacheKey: normalizeDishName(dish), originalName: dish, course }));
console.log(`saved ${await saveDishCacheEntries(entries)} labels to dish_cache`);

if (out) fs.writeFileSync(out, JSON.stringify(labels, null, 1));
