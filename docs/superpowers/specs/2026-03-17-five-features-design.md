# Five-Feature Enhancement — Design Spec
**Date:** 2026-03-17
**Project:** Canteen (Next.js 16, React 19, Upstash Redis, Vercel)
**Status:** Approved by user

> Features numbered 3, 4, 5, 8, 9 — numbers 1, 2, 6, 7 are separate features not in this spec.

---

## Overview

Five additive features for the canteen lunch app. All must match the existing Nordic Warmth design theme: warm cream/amber gradients, subtle shadows, smooth spring animations, no external UI library additions.

---

## Feature 3 — Skeleton Loading

### Problem
When `!menuData || !mounted`, the app shows a plain `<span style={{ color: "#999" }}>Loading...</span>`. This is jarring — nothing visible until all fetches resolve (~1–2s on slow connections).

### Solution
Replace the loading gate with 3 ghost cards mirroring the real `food-card` shape.

### Card skeleton anatomy
- **Top zone** (`#fffaf0 → #fef3e2` gradient, same as real card): circular image placeholder (260px diameter), shimmer
- **Middle**: two shimmer text bars (~120px canteen name width, ~200px dish name width)
- **Separator line**: 1px warm divider
- **Bottom strip**: three short shimmer bars for side dishes

### Shimmer
Re-use the existing `@keyframes shimmer` from `globals.css`. Add `.skeleton-block` utility using the same warm shimmer (`#fffaf0 → #fef3e2 → #fffaf0` at 200% width).

### Implementation
- New component: `src/components/SkeletonCard.tsx` — pure CSS, no state
- Rendered in `page.tsx` instead of the loading guard: `if (!menuData || !mounted) return <SkeletonCards />`
- `SkeletonCards` wraps 3 `SkeletonCard` instances inside a `<div className="cards-animated-wrapper">` (no `key={selectedDay}` needed here — skeleton is pre-data) to match real layout geometry exactly and prevent layout shift on hydration
- `animationDelay` stagger (0/75/150ms) applies only to entry animation, not shimmer. Under `prefers-reduced-motion`, skip the entry animation but keep the shimmer static (no motion, just a flat gradient). Do **not** skip the skeleton entirely — users still need to see something while loading.

### CSS additions
- `.skeleton-card` — same border-radius, padding, min-height, shadow as `.food-card`
- `.skeleton-block` — shimmer animation utility
- `.skeleton-circle` — for the circular image placeholder
- `@media (prefers-reduced-motion: reduce)` → set `animation: none` on `.skeleton-block` and `.skeleton-card`

---

## Feature 4 — Swipe Gesture Hint

### Problem
The swipe-to-change-day gesture is invisible to new users.

### Solution
A one-time animated hint: two `‹` `›` chevrons at the edges of the cards area that pulse once and fade out.

### Behaviour
- In the init `useEffect`, check `localStorage.getItem("swipe_hint_seen")`
- If not set: `setShowSwipeHint(true)` and immediately `localStorage.setItem("swipe_hint_seen", "1")` (never shown again)
- Auto-dismiss: `setTimeout(() => setShowSwipeHint(false), 2500)`
- Instant dismiss: inside the existing `onTouchStart` handler on `scrollRef`, add `if (showSwipeHint) setShowSwipeHint(false)` — this reuses the existing handler, no extra listener needed
- `prefers-reduced-motion`: show the hint statically (no pulse animation) so users still discover the gesture, but no movement. Use `@media (prefers-reduced-motion: reduce)` in CSS to set `animation: none`.

### Visual
- Two `<span>` elements, `position: absolute`, vertically centered inside `.cards-container`, at left/right edges
- SVG chevron icons, 28px, same stroke-width as existing icons
- Color: `rgba(200, 116, 26, 0.55)` (warm amber accent)
- `pointer-events: none` — never blocks interaction
- CSS: `@keyframes swipeHintPulse` — fade in → scale 1.0 → 1.2 → 1.0 → fade out, 2.5s total

### State
```ts
const [showSwipeHint, setShowSwipeHint] = useState(false);
```
Set in the existing `useEffect(() => { ... setMounted(true); ... }, [])` block.

---

## Feature 5 — Vote Leaderboard

### Problem
Vote history is archived to Redis (`attendance:YYYY-MM-DD`) but never surfaced. Users can't see which canteen wins most often.

### New API: `GET /api/attendance/history`
- Constructs last 14 calendar day keys: `attendance:YYYY-MM-DD` where dates are **UTC** (consistent with how existing archive logic stores them via `new Date().toISOString().split('T')[0]`). This means a vote cast at 23:30 CET may land in the next UTC day's bucket — this is an accepted limitation given the app's informal context.
- Uses `redis.mget(...keys)` — single round-trip
- Returns only entries where at least one vote was cast: `{ entries: Array<{ date: string; canteens: Record<string, number> }> }`
- Weekend days will naturally have no Redis entry and will be absent from the result — no explicit date-of-week filtering needed in the API. Do not add `getDay()` checks.

### Derived stats (computed client-side)
- **Win count per canteen** — days where that canteen had the highest vote count. On ties, all tied canteens each get +1 win.
- **Total votes per canteen** across all days

### UI: LeaderboardModal component
- `src/components/LeaderboardModal.tsx`
- Trigger: trophy SVG icon button added to `.header-actions`, between the info button and lang switcher
- Modal uses same overlay pattern as `infoOpen` in `page.tsx`
- On open: fetches `/api/attendance/history`; shows 3 skeleton rows while loading (each row: `~40px` height, `.skeleton-block` bar placeholder)

### Leaderboard layout
- Header: "Kantineseiere — siste 2 uker" / "Canteen wins — last 2 weeks"
- 3 rows sorted by win count descending; each row:
  - Canteen name (left, 110px fixed)
  - Horizontal amber bar (`background: #c8741a`, `opacity: 0.7`) proportional to win count, flex-grow
  - Label: "3 seiere" / "3 wins" (right of bar)
- Below bars: day-by-day dots for the same 14-day window as the bars — small coloured circles; **green for all canteens that tied on a given day**, grey for others. Ordered oldest-left to newest-right. (14 days matches the API window; keeps bars and dots consistent.)
- Footer: "Basert på daglige stemmer" / "Based on daily votes"

### State in page.tsx
```ts
const [leaderboardOpen, setLeaderboardOpen] = useState(false);
```

---

## Feature 8 — Slack Share Button

### Problem
No way to share today's vote results with the team.

### Decision
Public button — anyone can send. Client-side rate limit: once per day per browser via `localStorage.getItem/setItem("slack_shared_YYYY-MM-DD")`.

### New API: `POST /api/notify`
Request body:
```ts
{
  canteens: Record<string, number>;   // vote counts for all canteens
  dishes: Record<string, string>;     // canteen name → main dish name for all canteens
  date: string;                       // "YYYY-MM-DD"
  lang: "no" | "en";
}
```

**Building the `dishes` payload (client-side):** The handler that fires the POST must iterate `canteenDayData` (the existing per-selected-day memo, which is in scope at the call site) and build `{ [c.canteenName]: c.mainDish?.dish ?? "" }` for all 3 canteens. This is done at the call site in `page.tsx`, not inside the LeaderboardModal or action sheet button itself.

Slack message format:
- Header: `🍽️ Lunsjresultater — {date}` / `Lunch results — {date}`
- 3 lines, one per canteen, sorted by votes desc:
  - `⭐ Kantine X — Dish name — 5 stemmer` (winner gets ⭐)
  - `   Kantine Y — Dish name — 3 stemmer`
- Uses Slack Block Kit `section` with `mrkdwn: true` for bold winner
- Returns `{ ok: true }` on success, `{ error: string }` on failure, `{ skipped: true }` if `SLACK_WEBHOOK_URL` is unset (200 in all cases)

### ENV
`SLACK_WEBHOOK_URL` — Incoming Webhook URL. Optional; silently no-ops if absent.

### UI placement
- Inside the **action sheet**, below the vote/recipe buttons
- Visibility guard: `selectedDay === activeDayIndex && !sheetCanteen?.isOutdated && !sheetCanteen?.isAhead` — today only, current-week menu only
- **When `voteSuccess` is true**, the action sheet shows the celebration UI. The share button lives **within the `voteSuccess` state block**, as an additional action below the celebration. **Remove the existing `setTimeout(closeSheet, 1500)` auto-close when the share button is visible** (i.e., when `canVote` is true — same guard as the share button itself). Instead, let the user close manually. This gives them time to tap Share. When `canVote` is false (not today's day, or outdated/ahead), the auto-close remains as-is.
- When not in `voteSuccess` state: share button is at the bottom of the normal actions list
- Button label: "Del resultater" / "Share results" + small share SVG icon
- States:
  - Default: ghost/outline style matching existing action sheet buttons
  - Loading: spinner, disabled
  - Sent: "Sendt! ✓", green tint, 2s then reset
  - Already sent today: greyed out, `cursor: not-allowed`, `title="Allerede delt i dag"` / `"Already shared today"`

---

## Feature 9 — Weekly Overview Sidebar

### Problem
Users can only see one day at a time with no way to scan the full week.

### Solution
A slide-in panel triggered by a calendar icon in the header.

### Panel behaviour
- **Desktop (≥769px):** slides in from right, `position: fixed`, full viewport height, 380px wide. Scrim behind (`rgba(0,0,0,0.25)`). Animation: `transform: translateX(100%)` → `translateX(0)`, 300ms `ease-out`.
- **Mobile (<769px):** slides up from bottom, `max-height: 85dvh`, `position: fixed`. `.action-sheet-handle` at top. Animation: `translateY(100%)` → `translateY(0)`, 300ms `ease-out`.
- Dismiss: click scrim, press Escape, or × button. **Add both `weekOverviewOpen` and `leaderboardOpen` to the dependency array of the existing `handleKeyDown` useEffect** so Escape closes both. Order: check `weekOverviewOpen` first, then `leaderboardOpen`, following the existing pattern (most-recently-opened closes first).
- Close on cell click: `handleDaySelect(dayIndex)` then `setWeekOverviewOpen(false)`, no delay needed.

### `canteenDayData` refactor (critical)
Current: `canteenDayData` computed for a single `dayKey` in a `useMemo`.

Refactor to `allDaysData`:
```ts
const allDaysData = useMemo((): CanteenDayItem[][] => {
  return DAY_KEYS.map(dk => {
    return sortedCanteens.map(([canteenName, canteen]) => {
      // same logic as current canteenDayData, but using dk instead of dayKey
    });
  });
}, [sortedCanteens, lang, dishOrigins, dishDescriptions, currentWeek]);
// Note: dayKey removed from deps — allDaysData covers all days

const canteenDayData = useMemo(() => allDaysData[selectedDay], [allDaysData, selectedDay]);
```

The `allDaysData` memo will recompute when `dishOrigins` or `dishDescriptions` state updates. This is acceptable — those fetches happen once on mount and rarely trigger re-renders after settling.

### WeekOverview component
`src/components/WeekOverview.tsx`

Props:
```ts
interface WeekOverviewProps {
  allDaysData: CanteenDayItem[][];   // [dayIndex][canteenIndex]
  selectedDay: number;
  todayIndex: number;
  dayLabelsData: string[];           // ["17.03", "18.03", ...] — already computed in page.tsx
  fullDayLabels: string[];           // ["Mandag", ...]
  lang: "no" | "en";
  onDaySelect: (i: number) => void;
  onClose: () => void;
}
```

Internal state:
```ts
const [activeCanteenTab, setActiveCanteenTab] = useState(0); // mobile only
```

### Desktop grid layout
- Column headers: day abbreviation + date (e.g. "Man 17.03"), today column underlined
- 3 rows × 5 columns; each cell:
  - Canteen name: 8px uppercase muted label
  - Main dish: 13px, 2-line clamp, `overflow: hidden`
  - Left border highlight: 2px `#c8741a` if that column is today
  - Greyed-out + italic if `isOutdated || isAhead || isClosed` where `isClosed` means `!mainDish && (!items || items.length === 0)` — same condition as the existing `isClosed` check in `FoodCard.tsx`
  - Clickable → `onDaySelect(dayIndex)` + `onClose()`
- Scrollable vertically if needed

### Mobile layout
- Three canteen name tabs at top (pill tabs, same style as `.day-selector`)
- Below: vertical list of 5 day cells for the `activeCanteenTab` canteen
- Each day cell: day name + date (left) + main dish name (right, 1-line clamp)
- Today's cell: amber left border
- Tap → `onDaySelect(dayIndex)` + `onClose()`

### Header button
Calendar SVG icon button added to `.header-actions`. Same size/style as `info-btn`. Placed between info and trophy buttons.

---

## Header layout (4 buttons)
`.header-actions` will have: `[ⓘ info]` `[🏆 leaderboard]` `[📅 week overview]` `[NO / EN switcher]`. On viewports ≤360px, the info and trophy buttons collapse to icon-only (no text label — they're already icon-only). The lang switcher is 2 text buttons. Test at 320px minimum to confirm no overflow. If needed, reduce `.header-actions` gap from current value to `6px`.

---

## Shared CSS Additions

All new CSS in `globals.css`, in named sections:

| Section | Classes |
|---|---|
| Skeleton | `.skeleton-card`, `.skeleton-block`, `.skeleton-circle` |
| Swipe hint | `.swipe-hint-left`, `.swipe-hint-right`, `@keyframes swipeHintPulse` |
| Leaderboard | `.leaderboard-overlay`, `.leaderboard-modal`, `.leaderboard-bar-row`, `.leaderboard-bar`, `.leaderboard-dots` |
| Share button | `.share-btn`, modifiers `.sent`, `.disabled` |
| Week overview | `.week-overlay`, `.week-panel`, `.week-grid`, `.week-cell`, `.week-cell.today`, `.week-cell.closed`, `.week-tabs`, mobile overrides |

---

## Data & API Summary

| Endpoint | Method | New? | Purpose |
|---|---|---|---|
| `/api/attendance` | GET/POST | existing | Live vote counts |
| `/api/attendance/history` | GET | **new** | Last 14 UTC days of archived votes |
| `/api/notify` | POST | **new** | Send Slack webhook |

---

## New Files

- `src/components/SkeletonCard.tsx`
- `src/components/LeaderboardModal.tsx`
- `src/components/WeekOverview.tsx`
- `src/app/api/attendance/history/route.ts`
- `src/app/api/notify/route.ts`

## Modified Files

- `src/app/page.tsx` — skeleton gate, swipe hint state, leaderboard state, week overview state, `allDaysData` refactor, Slack button in action sheet + voteSuccess state, 3 new header icon buttons, `handleKeyDown` deps update
- `src/app/globals.css` — new CSS sections for all features

---

## Out of Scope

- Teams/Discord for feature 8 (Slack only)
- Leaderboard beyond 14 days
- Allergen filter, PWA, dark mode
