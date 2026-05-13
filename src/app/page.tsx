import { supabase } from "@/lib/supabase";
import HomeClient from "@/components/HomeClient";
import type { MenuData } from "@/lib/types";

// Re-render at most every 60s. Plenty fresh — smart-update.js writes
// new menus only on the workflow schedule (Mon-Fri morning + pre-lunch).
export const revalidate = 60;

type DishDescription = string | { en: string; no: string };
type DishOrigin = { country: string; code: string };

/** ISO week id for today (Europe/Oslo wall clock), matching smart-update.js's "YYYY-Www" format. */
function currentISOWeekId(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const week =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    );
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function fetchWeek(weekId: string | null) {
  let q = supabase
    .from("weekly_menus")
    .select("menu_data, dish_origins, dish_descriptions");
  if (weekId) {
    q = q.eq("week_id", weekId);
  } else {
    q = q.order("week_id", { ascending: false }).limit(1);
  }
  const { data } = await q.maybeSingle();
  return data;
}

export default async function Page() {
  const day = new Date().getDay(); // 0 = Sun, 6 = Sat
  const isWeekend = day === 0 || day === 6;

  // Weekday: pin to today's actual ISO week so a single canteen publishing
  // next week's menu early doesn't bump the whole site forward.
  // Weekend: prefer the latest row — HomeClient's computeDisplayContext has
  // the "weekend-preview" path that handles next-week preview cleanly.
  let data = isWeekend
    ? await fetchWeek(null)
    : await fetchWeek(currentISOWeekId());

  // Fallback when pinning misses (e.g. Monday morning before the first scrape).
  if (!data) data = await fetchWeek(null);

  const initialMenu = (data?.menu_data ?? null) as MenuData | null;
  const initialOrigins = (data?.dish_origins ?? {}) as Record<string, DishOrigin>;
  const initialDescriptions = (data?.dish_descriptions ?? {}) as Record<string, DishDescription>;

  return (
    <HomeClient
      initialMenu={initialMenu}
      initialOrigins={initialOrigins}
      initialDescriptions={initialDescriptions}
    />
  );
}
