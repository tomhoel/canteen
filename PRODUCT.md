# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Coworkers on one workplace campus deciding where to eat lunch. The typical moment is around 10:30 on a weekday: they open the app installed on their Android or iPhone home screen, look at what the three canteens serve today, pick one, and close it. Some open it in a browser tab on a work laptop instead. Most are Norwegian speakers. Some colleagues are not, and they need English.

## Product Purpose

To show today's lunch at the three canteens side by side, so choosing one takes seconds. It replaces walking past three TV menu boards, or opening three separate widget pages. Success means a fast glance: open it, see the mains, decide, done.

## Positioning

It is the only place the three canteens' boards sit next to each other. Each board is scraped twice a day from the InSign widget that hangs in the canteen itself, and each day's main dish gets a plate photo, so you choose by looking at food rather than reading three lists.

## Operating Context

- Mostly opened from the home-screen PWA, standing up or on the way out. Safe-area insets and standalone display are real constraints.
- On weekdays it opens on today. At the weekend it previews next week once the kitchens publish it, and otherwise recaps the week that just ended. `computeDisplayContext` in `src/lib/dateUtils.ts` decides this.
- There is a vote for "where are you eating today", which coworkers use to coordinate.

## Capabilities and Constraints

- **The three canteens**, in this order: Eat the Street (Bygg J/K, 1st floor, 10:30–14:00, dinner Mon–Thu 15:00–17:00), Fresh 4 You (Bygg C/D, 1st floor, 10:30–13:00) and Kantine M, formerly Flow (Bygg M, 2nd floor, 10:30–13:00). Bakern and the cafés publish no menu and get no card.
- **The design stays as it is.** Two redesigns were mocked and rejected (2026-11-01). The current look (warm palette, Outfit, cards with the plate overlapping the top on desktop and on the left on phones, the floating day dock) is the brand. Work improves the experience and the motion, not the look.
- **Each card shows** the canteen, the main dish, a plate photo, the origin flag, allergens for the main, and the side dishes. The AI one-line description is no longer shown.
- **Tapping a card** opens a slide-up sheet with the plate, the dish, the canteen's building, floor and hours, and on today the vote.
- **Tapping a plate** opens it full-screen. The plate flies out of the card and back.
- **Days:** opens on today. The day dock, swipe, arrow keys and trackpad all move the same board. There is no separate week-overview screen.
- **Voting** is through the sheet, with a head-count on each card. The tally loads after the menu and must never delay the first paint.
- **Languages:** Norwegian and English, with a toggle. The canteen boards publish an English copy of each day. The scraper currently drops it (`scraper.service.ts`), so English dish names need a pipeline change. Open: what to show when a board has no English copy for a day.
- **Removed:** AI recipe, meny.no and kassal grocery prices, the leaderboard, confetti and toasts, the Slack vote post, the week-overview modal and the YOLO randomiser. This includes `/api/recipe`, `/api/meny`, `/api/deals` and `/api/notify`.
- **Motion** is snappy and physical (100–320 ms, no loops, no overshoot). See `docs/superpowers/specs/2026-11-01-ux-motion-design.md`.
- **Speed is a feature.** A page view never scrapes. The menu is a static JSON file per week in Supabase Storage, and a returning visitor is painted from `localStorage` before the network answers.
- **Stack:** React + Vite, plain CSS, no animation library.

## Evidence on Hand

- Real menu data: `menu-response/<week>.json` in Supabase Storage, and the HTML fixtures in `src/server/services/__fixtures__/`.
- Plate photos: background-removed PNGs under `images_nobg/archive/*`, with 512px thumbs under `images_nobg/thumb/*`.
- The app icon is `public/icon.svg`. There is no other brand asset, logo or brand colour that must be kept.

## Product Principles

1. A glance, not a session. Today's three mains are readable within a second of opening, with no tap needed.
2. Food first. The plate and the dish name carry the card, and everything else is quieter.
3. Fewer things, done properly. Every feature left in earns its place every lunch.
4. Never wait on the network for what is already known. Cached menu first, live data after.
5. The canteen's own board is the source of truth. Show what the kitchen published, and don't embellish it.

## Accessibility & Inclusion

Norwegian and English. Readable outdoors and at arm's length on a phone. Allergen information must be available as text, never only as colour or icon.
