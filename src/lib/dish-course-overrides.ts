import type { DishCourse } from "./types";

/**
 * Hand-set courses, for the dish the model or the name rules get wrong.
 *
 * This wins over everything else in `scoreMainDish`: a stored model label, the
 * name rules, the guess. It is a code file on purpose. The alternative was
 * editing a Redis hash by hand, which nobody can review, and which a re-label
 * would quietly undo; a line here is in git with a reason next to it.
 *
 * Key: the dish name exactly as the menu prints it, lowercased and trimmed. Add
 * both languages when the kitchen prints both. The fix applies the next time
 * the updater re-ranks the week (any cron run); past weeks keep their pick.
 */
export const COURSE_OVERRIDES: Record<string, DishCourse> = {
  // Marinated mussels read as a plated seafood main, so they beat a beef wok
  // on tier alone. They are one dish among several, not the headline
  // (W37 Friday, Eat the street, next to Biff Szechuan med nudler).
  "marinerte økologiske blåskjell": "meat_mixed",
  "marinated organic mussels": "meat_mixed",
};

export function courseOverride(dish: string): DishCourse | undefined {
  return COURSE_OVERRIDES[(dish || "").trim().toLowerCase()];
}
