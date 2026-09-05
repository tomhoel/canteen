/**
 * Purge stale localStorage keys.
 *
 * `voted_` and `slack_shared_` are date-keyed and accumulate one entry per day,
 * so they age out after a week.
 *
 * The three prefixes below are different: nothing in the app writes them any
 * more. They are what is left of a client-side cache for recipes, deals and
 * Meny results, and the only writes remaining anywhere are `canteenScrollPos`,
 * the menu cache, `voted_` and `slack_shared_`. So these are pure legacy, and
 * are removed on sight rather than by age — the old age check keyed off a
 * `generatedAt` field inside the payload, which meant any entry written without
 * one could never be collected at all.
 */
export function cleanupLocalStorage() {
  /** Written by no version of this app that is still shipping. */
  const LEGACY_PREFIXES = ["recipe_v4_", "deals_v4_", "meny_v4_"];
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;

    // Clean old voted_ and slack_shared_ keys (date-keyed)
    if (key.startsWith("voted_") || key.startsWith("slack_shared_")) {
      const dateStr = key.split("_").pop();
      if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const age = now - new Date(dateStr + "T12:00:00").getTime();
        if (age > MAX_AGE) localStorage.removeItem(key);
      }
      continue;
    }

    // Retired caches: no reader, no writer, so age is irrelevant.
    if (LEGACY_PREFIXES.some(p => key.startsWith(p))) {
      localStorage.removeItem(key);
    }
  }
}

