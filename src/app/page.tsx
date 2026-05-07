import { supabase } from "@/lib/supabase";
import HomeClient from "@/components/HomeClient";
import type { MenuData } from "@/lib/types";

// Re-render at most every 60s. Plenty fresh — smart-update.js writes
// new menus only on the workflow schedule (Mon-Fri morning + pre-lunch).
export const revalidate = 60;

type DishDescription = string | { en: string; no: string };
type DishOrigin = { country: string; code: string };

export default async function Page() {
  const { data } = await supabase
    .from("weekly_menus")
    .select("menu_data, dish_origins, dish_descriptions")
    .order("week_id", { ascending: false })
    .limit(1)
    .single();

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
