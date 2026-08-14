import type { MenuData, DishOrigin, DishDescription } from "../lib/types.ts";
import { getWeeklyMenuService, runWeeklyUpdateService } from "./services/menu.service.ts";

export interface WeeklyMenuResponse {
  menuData: MenuData;
  dishOrigins: Record<string, DishOrigin>;
  dishDescriptions: Record<string, DishDescription>;
}

/** Raised when no menu could be served, so the endpoint can answer 503. */
export class MenuUnavailableError extends Error {}

/**
 * Reads the stored menu for the app.
 *
 * This used to swallow every failure and return a hardcoded INITIAL_MENU_DATA
 * stub instead — which made a completely broken data pipeline look like a
 * working app serving a strangely empty week. A failure here is now visible:
 * the route renders its error state and the log says why.
 */
export async function getWeeklyMenu(weekId?: string): Promise<WeeklyMenuResponse> {
  const record = await getWeeklyMenuService(weekId);

  if (!record?.menuData) {
    throw new MenuUnavailableError(
      weekId
        ? `No menu stored for ${weekId}.`
        : "No menu data available yet — the weekly update has not populated this week."
    );
  }

  return {
    menuData: record.menuData,
    dishOrigins: record.dishOrigins || {},
    dishDescriptions: record.dishDescriptions || {},
  };
}

export { runWeeklyUpdateService };
