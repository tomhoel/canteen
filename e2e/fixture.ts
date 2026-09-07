import { getWeekId, getWeekNumber } from "../src/lib/dateUtils.js";
import type { MenuData, MenuItem } from "../src/lib/types.js";

/**
 * A menu for whatever week it is when the tests run.
 *
 * Derived from the app's own `getWeekId` rather than pinned to a date, and that
 * is the whole point: a fixture with a hard-coded week goes stale the following
 * Monday and starts failing CI for a reason that has nothing to do with the
 * change under test. This repo has been bitten by exactly that before. Nothing
 * here carries a date the calendar can overtake.
 *
 * The dishes are deliberately synthetic. Real scraped names drift week to week,
 * and a test that asserts on today's lunch is a test that fails when the
 * kitchen changes its mind.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAYS_NO = ["MANDAG", "TIRSDAG", "ONSDAG", "TORSDAG", "FREDAG"];

/** Matches CANTEEN_ORDER, so the cards render in the order the app expects. */
const CANTEENS = ["Eat the street", "Fresh4you", "Flow"];

function item(dish: string, isMain: boolean): MenuItem {
  return { dish, isMain, allergens: isMain ? [{ id: "3", name: "Gluten" }] : [] };
}

/**
 * Three side dishes on every card, on purpose.
 *
 * The card layout's hardest case is canteens with *different* numbers of sides
 * — that is what used to make the three cards different heights. The equal
 * heights assertion is only meaningful against uneven input, so the counts vary
 * per canteen below rather than being uniform.
 */
function dayMenu(canteen: string, dayIdx: number, sideCount: number, label: string) {
  const items: MenuItem[] = [item(`${canteen} hovedrett ${DAYS[dayIdx]}`, true)];
  for (let s = 0; s < sideCount; s++) {
    items.push(item(`${canteen} siderett ${s + 1}`, false));
  }
  return { label, items };
}

export function buildMenuFixture() {
  const weekId = getWeekId();
  const weekNumber = getWeekNumber();

  const canteens: MenuData["canteens"] = {};
  CANTEENS.forEach((name, canteenIdx) => {
    // 3, 2 and 1 sides — uneven by design; see dayMenu's note.
    const sideCount = 3 - canteenIdx;
    canteens[name] = {
      week: `Uke/week ${weekNumber}`,
      openingHours: "10:30 - 13:00",
      menu: DAYS.map((day, dayIdx) => ({
        day,
        no: dayMenu(name, dayIdx, sideCount, DAYS_NO[dayIdx]),
        en: dayMenu(name, dayIdx, sideCount, DAYS[dayIdx].toUpperCase()),
      })),
    };
  });

  return {
    weekId,
    menuData: { scrapedAt: new Date().toISOString(), canteens },
    dishOrigins: {},
    dishDescriptions: {},
    dishShortNames: {},
    // Keyed "<day>|<canteen>", exactly as the server emits it. The paths are
    // never fetched — the test intercepts Supabase's storage host — but they
    // have to be present or the cards render a letter placeholder instead of a
    // plate, and the plate is part of what the layout assertions measure.
    plateImages: Object.fromEntries(
      DAYS.flatMap((day) =>
        CANTEENS.map((c) => [`${day.toLowerCase()}|${c}`, `archive/${c.toLowerCase().replace(/\s+/g, "-")}.png`])
      )
    ),
  };
}

/** Two weeks of vote counts, so the leaderboard has something to draw. */
export function buildAttendanceFixture() {
  return { entries: [] as Array<{ date: string; canteens: Record<string, number> }> };
}
