# Lunsj: fewer features, better motion

Date: 2026-11-01 · Branch `claude/pensive-heisenberg-yqhe3t`

## Intent

Make the app faster and calmer without changing how it looks. The visual design (warm palette, Outfit, cards with overlapping plates, floating day dock) stays as it is. The work is:

1. remove the features nobody needs at lunch,
2. replace decorative motion with a few fast, physical movements that explain what happened.

Two redesigns were mocked and rejected ("keep the design"). They are not part of this.

## Goals

- Swiping between days feels like moving a physical board: it follows the finger 1:1, settles quickly, and can be chained without waiting.
- A tap on a day, the arrow keys and a trackpad swipe move the board the same way a finger does: one movement model, not three.
- Nothing loops or moves while the app is idle.
- Less JavaScript and CSS shipped.

## Non-goals

- New visual design, colours or fonts.
- English (NO/EN). It needs the scraper to keep the board's English copy, so it gets its own PR next.
- Changes to the pipeline (the AI descriptions are still generated, just no longer shown).

## Anti-goals

- Motion that delays reading the menu.
- Any regression in the swipe's existing robustness: axis lock, rubber band at Monday and Friday, catching a glide mid-flight, Android back closing overlays.

## Decisions (made by the owner)

| Area | Decision |
| --- | --- |
| Removed | AI recipe, meny.no products and kassal deals; the leaderboard and Slack post/share; the week-overview modal; YOLO randomiser; confetti; toast library |
| Kept | The three cards, plates, day dock, vote (through the slide-up sheet, now vote-only), info modal, lightbox, loading screen |
| Card | No AI description line. Building and hours shown on the card |
| Header | Info button only (trophy and calendar removed) |
| Motion feel | Snappy and physical: few animations, 100–320 ms, no loops, no decoration |
| Day change | The board follows the finger; tap, keys and trackpad use the same glide |
| Opening | One quick entrance: cards rise and fade in with a short stagger, under 400 ms |
| Plate view | The plate grows from its spot on the card to full screen and shrinks back |
| Remove | Drifting gradient blobs (gradient stays, static), 3D tilt, shimmer/pulses/pops, vote celebration |

## Approaches considered (day change)

1. **Keep the two-mechanism model and tune it** (swipe = track push with parallax and scale; tap = per-panel enter/exit keyframes). Cheapest, but taps and swipes keep moving differently, and the parallax scale re-rasterises text on phones.
2. **One track, one glide (chosen).** Every day change mounts the target day beside the current one and glides the track. The finger drives the same transform the tap animates. One code path, consistent feel, and transform-only.
3. **CSS scroll-snap carousel.** Native physics for free, but five days must be mounted (15 cards and plates), the snap timing can't be controlled, and the existing edge, axis and overlay rules would have to be rebuilt on scroll events.

## Motion spec

- **Day change.** The track is translated in px. The neighbour sits one width plus a 16 px gap away. Drag is 1:1, rubber-banded past Monday and Friday. Release uses the existing velocity projection (`shouldTurn`). The glide runs 160–300 ms depending on remaining distance and release speed, eased `cubic-bezier(0.22, 1, 0.36, 1)`. A cancelled drag springs back in ≤ 220 ms. A new touch during a turn finishes that turn at once and starts a new drag from the new day, so swipes chain. A tap, arrow key or trackpad flick mounts the target day beside the current one and runs the same glide. On desktop the same glide moves the three-card row.
- **Trackpad.** Horizontal wheel deltas drive the offset like a finger. Passing the turn threshold commits; going idle below it springs back. The momentum tail after a turn is ignored.
- **Day dock.** The highlight tracks drag progress continuously between the two days, then glides with the board.
- **Opening.** Cards rise 12 px and fade in, 50 ms stagger, 300 ms each, once per open. No scale.
- **Plate view.** FLIP: measure the card plate, start the full-size plate at that rect, animate to centre (320 ms). The backdrop fades (200 ms). Closing reverses (240 ms).
- **Sheet and vote.** The sheet slides up (300 ms) and down (220 ms). The vote button presses (100 ms) and confirms with a check, with no emoji burst.
- **Reduced motion.** No spatial movement. The day change is a 120 ms crossfade and the plate view fades. Feedback colour changes remain.

## Plan

1. Remove the cut features: components, hooks, CSS, `api/recipe|meny|deals|notify`, `src/server/recipe|meny|deals|notify`, and the `canvas-confetti`/`sonner` deps.
2. Strip decorative motion: the static gradient, no 3D wrapper, delete unused keyframes and looping animations.
3. Rebuild the day change in `useDaySwipe`, `HomeClient`, `DayPanel`, the CSS and `DaySelector`, with tests for the pure helpers.
4. Opening entrance, lightbox FLIP, sheet and vote feedback.
5. Verify: `npm test`, lint, typecheck, build and Playwright e2e (updated for the new behaviour), plus screenshots on phone and desktop.

## Left to the builder

The exact timing within the ranges above, how to clean up the CSS, and which dead code beyond the listed files is safe to delete.

## Revision 2026-11-02: the day board is a native scroller

Approach 2 shipped and felt choppy on the owner's phone and laptop. Its drag ran on the main thread at the rate the browser delivers touch events (60 Hz on iPhone, and only when nothing else is running), so it could never match the screen, and the release glide did not start at the finger's speed. Approach 3 replaces it:

- `.cards-track` is a horizontal `scroll-snap-type: x mandatory` scroller holding all five days (`scroll-snap-stop: always`, one day per flick). The browser runs the drag, momentum, edge bounce and axis lock on the compositor at the full refresh rate.
- For a finger, `useDayScroller` only reads the position: it drives the dock highlight and header preview, and commits the day on `scrollend` (or 120 ms of quiet).
- The dock, arrow keys and trackpad do not use the browser's smooth scroll: measured at 880 ms for one desktop day, nearly still for its first 150 ms, and keys pressed during it were lost. They glide `.cards-board` by a CSS transform instead, on the dock pill's own timing and curve (`--glide-ms: 340ms`, `--glide-ease: cubic-bezier(0.23, 0.25, 0.1, 1)`; one token pair for both, so pill and board move as one — the owner found the pill's gentle-start curve smooth and the board's full-speed start a jolt), commit the day as the glide starts so the next press counts from there, re-aim a glide in flight from where it is, and swap the transform for the real `scrollLeft` in the same frame when it lands. During a glide the track has no snapping (snap points follow transformed boxes) and a spacer (a left-moving board would otherwise shrink the scroll range and get its position clamped).
- Mouse/trackpad (`hover: hover` and `pointer: fine`): the board is `overflow-x: hidden`, because a desktop day is a full window wide and native snap only moves on past halfway. A 50 px sideways swipe turns one page through the glide; the momentum tail is ignored.
- The other days are `inert`. Five days mounted costs twelve more cards than one, which measured as no visible cost; it is what removed the mount from the first frames of every swipe.
- Given up: the exact glide timing (the platform's own), and the hand-tuned turn threshold on touch (native paging rules apply).
