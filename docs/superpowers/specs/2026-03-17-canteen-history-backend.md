# Canteen History — Backend Spec

## Goal

Start recording history of all weekly canteen data so a browse-history UI can be built later. No UI is in scope for this spec — only data persistence.

## What Gets Archived

### File-based (committed to git weekly)

When the week number in `menu.json` changes, archive the current week's data to `public/history/YYYY-WXX/`:

| File | Source |
|------|--------|
| `menu.json` | `public/menu.json` |
| `dish-descriptions.json` | `public/dish-descriptions.json` |
| `dish-origins.json` | `public/dish-origins.json` |
| `images/` | `public/images/` (full directory copy) |
| `images_nobg/` | `public/images_nobg/` (full directory copy) |

The week key is derived from the `week` field in `menu.json` (e.g. `"UKE/WEEK 12"` → `2026-W12`).

`images_circular/` is excluded — it is not tracked in the workflow.

### Redis-based (vote history)

Before the daily reset in `src/app/api/attendance/route.ts`, save the current day's vote counts to key `attendance:YYYY-MM-DD` with no TTL. Format is identical to the existing `AttendanceData` interface.

## Changes Required

### 1. `smart-update.js`

Add an archive function that runs after reading the current `menu.json` and before writing the new scraped data:

1. Parse the week string from the current `menu.json` (e.g. `"UKE/WEEK 12"`)
2. Parse the week string from the newly scraped data
3. If the week numbers differ → run archiving:
   a. Determine the calendar year for the archive key (ISO week year)
   b. Create `public/history/YYYY-WXX/`
   c. Copy `menu.json`, `dish-descriptions.json`, `dish-origins.json`
   d. Recursively copy `public/images/` and `public/images_nobg/`
4. If weeks are the same → skip archiving (intra-week update, nothing to archive)

### 2. `.github/workflows/weekly-update.yml`

Add `public/history/` to the `git add` command:

```
git add public/menu.json public/images/ public/images_nobg/ public/dish-origins.json public/dish-descriptions.json public/history/
```

### 3. `src/app/api/attendance/route.ts`

In both GET and POST handlers, before resetting to a new day:

1. Read current data
2. If `data.date !== today` and `data.canteens` has at least one non-zero count:
   - Save to Redis key `attendance:${data.date}` (no TTL)
3. Proceed with reset as before

## Data Formats

### `public/history/YYYY-WXX/menu.json`
Identical to the current `public/menu.json` — the `MenuData` interface (`scrapedAt`, `canteens`).

### `public/history/YYYY-WXX/dish-descriptions.json` / `dish-origins.json`
Identical to their current counterparts in `public/`.

### Redis `attendance:YYYY-MM-DD`
```json
{ "date": "2026-03-17", "canteens": { "Eat the street": 12, "Flow": 8 } }
```

## Out of Scope

- History API endpoints (built later when UI is implemented)
- UI for browsing history
- `images_circular/` archiving
- Vote history in files
