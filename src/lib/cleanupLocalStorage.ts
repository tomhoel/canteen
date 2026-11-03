/**
 * Purge localStorage keys no shipping version of the app reads or writes:
 * the old recipe, deals and Meny caches, and the vote and Slack-share flags
 * (voting was removed). The only writes left are `canteenScrollPos` and the
 * menu cache, so everything below goes on sight.
 */
export function cleanupLocalStorage() {
  const LEGACY_PREFIXES = ["recipe_v4_", "deals_v4_", "meny_v4_", "voted_", "slack_shared_"];

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;

    // No reader, no writer, so age is irrelevant.
    if (LEGACY_PREFIXES.some(p => key.startsWith(p))) {
      localStorage.removeItem(key);
    }
  }
}

