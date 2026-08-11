import {
  INITIAL_MENU_DATA,
  INITIAL_DISH_ORIGINS,
  INITIAL_DISH_DESCRIPTIONS,
} from "@/data/initialMenu";
import type { MenuData, DishOrigin, DishDescription } from "@/lib/types";
import { getWeeklyMenuService, runWeeklyUpdateService } from "./services/menu.service";

export interface WeeklyMenuResponse {
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
}

export async function getWeeklyMenu(
  weekId?: string
): Promise<WeeklyMenuResponse> {
  try {
    const serviceRecord = await getWeeklyMenuService(weekId);
    if (serviceRecord && serviceRecord.menuData) {
      return {
        menuData: serviceRecord.menuData,
        dishOrigins: serviceRecord.dishOrigins || {},
        dishDescriptions: serviceRecord.dishDescriptions || {},
      };
    }
  } catch (err) {
    console.error("Error in getWeeklyMenu service lookup:", err);
  }

  return {
    menuData: INITIAL_MENU_DATA,
    dishOrigins: INITIAL_DISH_ORIGINS,
    dishDescriptions: INITIAL_DISH_DESCRIPTIONS,
  };
}

export { runWeeklyUpdateService };
