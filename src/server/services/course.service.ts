import { rankItems, type CourseLabels } from "../../lib/dish-ranking.js";
import type { MenuData } from "../../lib/types.js";
import { classifyCourses } from "./ai.service.js";
import { loadDishCache, saveDishCacheEntries, normalizeDishName } from "./dish-cache.service.js";

/**
 * Course labels for a set of dishes: what dish_cache already holds, plus a
 * model call for the ones it does not. New labels are stored, so a dish is
 * only ever asked about once.
 *
 * Never throws. A cache that cannot be read or a model that does not answer
 * leaves dishes unlabelled, and the ranking falls back to its name rules for
 * those: a worse pick for a day, not a failed run.
 */
export async function ensureCourses(dishes: string[]): Promise<CourseLabels> {
  const labels: CourseLabels = {};
  try {
    const { rows, failed } = await loadDishCache(dishes);
    if (failed) return labels;

    const missing: string[] = [];
    for (const dish of dishes) {
      const course = rows.get(normalizeDishName(dish))?.course;
      if (course) labels[dish] = course;
      else missing.push(dish);
    }
    if (missing.length === 0) return labels;

    const fresh = await classifyCourses(missing);
    const entries = Object.entries(fresh).map(([dish, course]) => {
      labels[dish] = course;
      return { cacheKey: normalizeDishName(dish), originalName: dish, course };
    });
    await saveDishCacheEntries(entries);
    console.log(`🍴 ${entries.length} of ${missing.length} new dishes given a course label.`);
  } catch (err: any) {
    console.warn(`⚠️  Course labelling failed: ${err?.message ?? err} — ranking by name rules.`);
  }
  return labels;
}

/**
 * Re-ranks every day of a week with the course labels, in place, and returns
 * how many days changed winner.
 *
 * This is the one place the day's main dish is decided; the result is stored
 * (items in ranked order, `isMain` on the first) and everything downstream
 * reads it. Items are matched to labels by trimmed name, the way
 * extractAllDishes keyed them.
 */
export function rerankMenu(menuData: MenuData, labels: CourseLabels): number {
  const byTrimmed: CourseLabels = {};
  for (const [dish, course] of Object.entries(labels)) byTrimmed[dish.trim()] = course;

  let changed = 0;
  for (const [canteenName, canteen] of Object.entries(menuData.canteens || {})) {
    for (const day of canteen.menu || []) {
      for (const lang of ["no", "en"] as const) {
        const list = day[lang];
        if (!list?.items?.length) continue;

        const forItems: CourseLabels = {};
        for (const item of list.items) forItems[item.dish] = byTrimmed[item.dish.trim()];

        const before = list.items.find((i) => i.isMain)?.dish;
        list.items = rankItems(list.items.map((i) => ({ ...i, isMain: false })), canteenName, forItems);
        if (lang === "no" && before !== undefined && before !== list.items[0].dish) changed++;
      }
    }
  }
  return changed;
}
