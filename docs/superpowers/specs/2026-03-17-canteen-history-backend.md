# Canteen History — Backend Spec

## Goal

Start recording history of all weekly canteen data so a browse-history UI can be built later. No UI is in scope for this spec — only data persistence.

## What Gets Archived

### File-based (committed to git weekly)

When the week number changes between the old and new scraped menu, archive the current week's data to `public/history/YYYY-WXX/`:

| File | Source |
|------|--------|
| `menu.json` | in-memory `oldMenu` (see timing note below) |
| `dish-descriptions.json` | `public/dish-descriptions.json` |
| `dish-origins.json` | `public/dish-origins.json` |
| `images/<day>/` | `public/images/monday/` … `friday/` (day subdirs only) |
| `images_nobg/<day>/` | `public/images_nobg/monday/` … `friday/` (day subdirs only) |

**Timing note:** `scraper.js` overwrites `public/menu.json` during `execSync`. The old menu must be read into memory (it already lives in `oldMenu`) _before_ the scraper runs. The archive function receives `oldMenu` as an argument — it does not re-read from disk.

**Image scope:** Only the day subdirectories (`monday/` through `friday/`) are copied. `master-plate-ref.png` and any other root-level files in `images/` are excluded to avoid unnecessary growth.

**Idempotency:** If `public/history/YYYY-WXX/` already exists, skip archiving silently. This handles re-runs of the workflow during the same week transition.

**Year derivation:** The archive key year is derived from the ISO week year of `oldMenu.scrapedAt` (a full ISO timestamp), not the wall clock. Example: `new Date(oldMenu.scrapedAt)` → ISO week year + week number → `2026-W12`.

**Error handling:** Archive failure is non-fatal. If any file copy fails, log a warning and continue with the menu update. The primary purpose of the workflow is delivering a fresh menu.

`images_circular/` is excluded — it is not tracked in the workflow.

### Redis-based (vote history)

Before the daily reset in `src/app/api/attendance/route.ts`, save the current day's vote counts to key `attendance:YYYY-MM-DD` with no TTL.

**Zero-count guard:** Only save if `Object.values(data.canteens).some(v => v > 0)` — key presence alone is not sufficient since `remove` actions can leave keys with value `0`.

**Idempotency:** Both GET and POST handlers trigger the save-before-reset logic independently. Concurrent writes to the same Redis key are acceptable — writes are idempotent (same data, same key). No locking required.

## Changes Required

### 1. `smart-update.js`

Add an `archiveCurrentWeek(oldMenu)` function called immediately after `oldMenu` is captured and before `execSync('node scraper.js')`:

1. Parse the week number from `oldMenu.canteens` (any canteen's `.week` field, e.g. `"UKE/WEEK 12"` → `12`)
2. Parse the week number from the newly scraped data (after scraper runs, read new menu from disk)
3. If week numbers differ → run archiving:
   a. Derive archive key from `oldMenu.scrapedAt` ISO week year + week number → `YYYY-WXX`
   b. If `public/history/YYYY-WXX/` already exists → skip, log, return
   c. Create `public/history/YYYY-WXX/`
   d. Write `oldMenu` as JSON to `public/history/YYYY-WXX/menu.json`
   e. Copy `dish-descriptions.json`, `dish-origins.json`
   f. Copy day subdirectories from `public/images/` and `public/images_nobg/` (monday–friday only)
   g. Wrap entire operation in try/catch — log warning on failure, do not rethrow
4. If weeks are the same → skip (intra-week update)

### 2. `.github/workflows/weekly-update.yml`

Add `public/history/` to the `git add` command:

```
git add public/menu.json public/images/ public/images_nobg/ public/dish-origins.json public/dish-descriptions.json public/history/
```

Note: the commit message `"Update weekly menu and food images YYYY-MM-DD"` will also be used for commits that only add a history archive. This is acceptable.

### 3. `src/app/api/attendance/route.ts`

In both GET and POST handlers, before resetting to a new day:

1. Check `data.date !== today`
2. Check `Object.values(data.canteens).some(v => v > 0)`
3. If both true → `await redis.set('attendance:' + data.date, data)` (no TTL)
4. Proceed with reset as before

## Data Formats

### `public/history/YYYY-WXX/menu.json`
Identical to the current `public/menu.json` — the `MenuData` interface (`scrapedAt`, `canteens`).

### `public/history/YYYY-WXX/dish-descriptions.json` / `dish-origins.json`
Identical to their current counterparts in `public/`.

### Redis `attendance:YYYY-MM-DD`
```json
{ "date": "2026-03-17", "canteens": { "Eat the street": 12, "Flow": 8 } }
```

## Storage Growth

`public/history/` is committed to git and served as static files by Next.js/Vercel. Each week adds ~3 canteens × 5 days × 2 image variants ≈ 30 images plus 3 JSON files. At ~150–300 KB per image this is ~5–15 MB/week. This is acceptable for a low-frequency internal tool; revisit if the repo grows unwieldy.

## Out of Scope

- History API endpoints (built later when UI is implemented)
- UI for browsing history
- `images_circular/` archiving
- Vote history in files
