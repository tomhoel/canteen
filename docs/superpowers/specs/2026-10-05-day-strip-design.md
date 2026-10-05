# Day strip: replace the JS swipe with native scroll-snap

Date: 2026-10-05 · Status: awaiting review

## Intent

Make day-to-day swiping on mobile feel native and smooth, and delete the machinery
that fights for it. Success: a finger or trackpad drives the page with no JS per
frame, the neighbor day is already there when the drag starts, `?day=` keeps working,
and the code shrinks.

Decided with Tom (2026-10-05): plain slide (no parallax/scale/shadow), and the same
strip on desktop and mobile.

## Answer to "do we need separate URLs per day?"

No. Keep `?day=` written with `replaceState` (src/lib/useSearch.ts). All five days
already arrive in one `/api/menu` response, so path routes would save no data, and
swiping would either stack history entries (Back walks Friday→Thursday) or need
`replaceState` anyway. URLs are not a performance factor here; the cost is the swipe
implementation below.

## What is wrong today

- The neighbor `DayPanel` (3 FoodCards + plates) mounts only after a 4px axis lock,
  so its render lands in the first frames of the gesture.
- `useDaySwipe.ts` (473 lines) writes `--swipe-x`/`--swipe-p` on every touchmove;
  CSS `calc()` rules restyle every card from them.
- One day change runs through three mechanisms: `current`/`leaving` panels,
  `swipingNeighbor`, and `fromSwipe` + `dayDir` + `previewDay` + `flushSync`.

## Design

**Structure.** `.cards-track` becomes the scroller:
`display:flex; overflow-x:auto; scroll-snap-type:x mandatory; overscroll-behavior-x:contain`,
scrollbar hidden. Each day is a `.day-panel` with `flex:0 0 100%; scroll-snap-align:start;
scroll-snap-stop:always`. Five panels, always in the DOM, in weekday order. Desktop and
mobile use the same track; only the panel's inner layout differs (already true).

**Mounting cost.** A panel renders real cards only for `selectedDay ± 1`; other days
render a same-size empty panel (so scroll positions are stable) and fill in once they
become a neighbor. Panels stay `memo`.

**State.** `selectedDay` is derived from scroll position on `scrollend` (fallback: a
short debounce on `scroll` where `scrollend` is missing). On change: `setSelectedDay`
and `setSearchParam("day", …)` as `handleDaySelect` does now.

**Programmatic changes** (day-bar tap, keyboard arrows, `?day=` popstate, default-day
seed): one function `goToDay(i, smooth)` that calls `track.scrollTo({left: i*width})`.
First paint and seeding use instant scroll so there is no slide on load.

**Day-bar pill preview.** A passive `scroll` listener computes `round(scrollLeft/width)`
and sets `previewDay` only when it changes (≤4 updates per swipe). Replaces the
15%/50% thresholds.

**Overlays.** While `anyOverlayOpen`, the track gets `overflow-x:hidden` so a swipe
underneath cannot turn the page (replaces the `blocked` flag).

**Deleted.** `src/lib/useDaySwipe.ts` and its test; `leaving`, `swipingNeighbor`,
`fromSwipe`, `dayDir`, `isSettlingRef`, the derived-state block and the
`useLayoutEffect` transform reset in HomeClient; DayPanel's enter/exit/neighbor phases,
`EXIT_FALLBACK_MS` and `inert` handling for them; the `.day-panel-enter/exit/neighbor-*`,
`.is-swiping`, `.is-settling` CSS and the `translate`/`scale`/`box-shadow` swipe rules;
`touch-action: pan-y` workaround on `.cards-container`.

**Kept.** DaySelector contract (`onDaySelect`, `selectedDay`, `cardsRef`), voting, YOLO
highlight, `?day=`/`?week=`, `isInitial` launch animation on the first day, keyboard
arrows, wheel (now native horizontal scroll; the custom wheel handler goes).

**Known trade-offs.** The browser decides when a flick turns the page (the tunable
15%-projected release rule is gone). Desktop loses its fade/slide transition and gets
the same slide as mobile. `scrollend` needs a fallback on older Safari.

## Risks to check in the plan

1. Nested scrolling: mobile cards may scroll vertically inside `.cards-container`;
   the strip must not capture vertical pans (`overflow-y` stays on the panel or
   container, verified on a real iPhone viewport).
2. Mobile `.cards-track` is `height:100%` with panels sized to the viewport; panels
   must keep that height in a flex row.
3. Height jump between days of different card counts (desktop stacked in one grid cell
   before; flex row now sizes to the tallest panel).
4. `scrollTo` smooth + `scroll-snap-stop` while a tap races a swipe.

## Testing

- Unit: the scroll-position→day function (rounding, clamping, RTL not needed).
- e2e (Playwright, `e2e/app.spec.ts`): rewrite the two tests that assert `.day-panel`
  counts of 1/2 — now assert 5 panels, only ±1 populated, swipe lands on the next day,
  `?day=` updates via replaceState without adding history, day-bar tap scrolls.
- Manual: iPhone Safari + Android Chrome real-device swipe, plus desktop trackpad.
- `npm run typecheck`, `npm test`, `npm run lint`.
