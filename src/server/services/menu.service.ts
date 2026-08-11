import { Redis } from "@upstash/redis";
import { createClient } from "@supabase/supabase-js";
import type { MenuData, WeeklyMenuRecord } from "@/lib/types";
import { scrapeAllCanteens } from "./scraper.service";
import { detectDishOrigins, generateDishDescriptions } from "./ai.service";

function getRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export function getWeekNumber(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export async function getWeeklyMenuService(weekId?: string): Promise<WeeklyMenuRecord | null> {
  const currentWeekNum = getWeekNumber();
  const targetWeekId = weekId || `2026-W${String(currentWeekNum).padStart(2, "0")}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get<WeeklyMenuRecord>(`menu:${targetWeekId}`);
      if (cached && cached.menuData) return cached;
    } catch (err) {
      console.error("Redis menu read error:", err);
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("weekly_menus")
        .select("*")
        .eq("week_id", targetWeekId)
        .maybeSingle();

      if (data && !error && data.menu_data) {
        const record: WeeklyMenuRecord = {
          weekId: data.week_id,
          menuData: data.menu_data,
          dishOrigins: data.dish_origins || {},
          dishDescriptions: data.dish_descriptions || {},
          scrapedAt: data.scraped_at,
        };

        if (redis) {
          await redis.set(`menu:${targetWeekId}`, record, { ex: 24 * 60 * 60 });
        }

        return record;
      }
    } catch (err) {
      console.error("Supabase menu read error:", err);
    }
  }

  // Live fallback scraping if no cached data exists for target week
  return await runWeeklyUpdateService(targetWeekId);
}

function extractAllDishes(menuData: MenuData): string[] {
  const dishes = new Set<string>();
  Object.values(menuData.canteens || {}).forEach((canteen) => {
    (canteen.menu || []).forEach((dayItem) => {
      ["no", "en"].forEach((langKey) => {
        const langData = dayItem[langKey as "no" | "en"];
        if (langData && Array.isArray(langData.items)) {
          langData.items.forEach((it) => {
            if (it.dish && it.dish.trim().length > 0) {
              dishes.add(it.dish.trim());
            }
          });
        }
      });
    });
  });
  return Array.from(dishes);
}

export async function runWeeklyUpdateService(weekIdInput?: string): Promise<WeeklyMenuRecord> {
  console.log("🚀 Starting Weekly Menu Scraping & AI Processing Service...");

  const menuData = await scrapeAllCanteens();
  const currentWeekNum = getWeekNumber();
  const weekId = weekIdInput || `2026-W${String(currentWeekNum).padStart(2, "0")}`;

  const allDishes = extractAllDishes(menuData);
  console.log(`🔍 Extracted ${allDishes.length} unique dishes.`);

  const [dishOrigins, dishDescriptions] = await Promise.all([
    detectDishOrigins(allDishes),
    generateDishDescriptions(allDishes),
  ]);

  console.log(`✨ Processed ${Object.keys(dishOrigins).length} origins and ${Object.keys(dishDescriptions).length} descriptions.`);

  const record: WeeklyMenuRecord = {
    weekId,
    menuData,
    dishOrigins,
    dishDescriptions,
    scrapedAt: new Date().toISOString(),
  };

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`menu:${weekId}`, record, { ex: 7 * 24 * 60 * 60 });
    } catch (err) {
      console.error("Redis menu set error:", err);
    }
  }

  const supabase = getSupabase();
  if (supabase) {
    try {
      await supabase.from("weekly_menus").upsert(
        {
          week_id: weekId,
          menu_data: menuData,
          dish_origins: dishOrigins,
          dish_descriptions: dishDescriptions,
          scraped_at: record.scrapedAt,
        },
        { onConflict: "week_id" }
      );
    } catch (err) {
      console.error("Supabase menu upsert error:", err);
    }
  }

  console.log("✅ Weekly Menu Update Complete!");
  return record;
}
