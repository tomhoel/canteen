# Canteen

The lunch menu for three workplace canteens — **Eat the street**, **Fresh4you**
and **Flow** — as an installable phone app. It shows the week's dishes in
Norwegian or English, a plate photo for each day's main dish, where the dish
comes from, a recipe for it, grocery prices for its ingredients, and a vote for
where people are eating today.

Production: <https://fbueat.vercel.app>

## The one rule

**A page view never scrapes anything.** The canteens are scraped, enriched and
photographed twice a day by a cron job that writes to Supabase; the app only
ever reads what is already stored.

This is worth stating first because the app broke this rule once and it was
invisible: `src/server/*` was imported straight into components, and since the
build is a client-only SPA, that shipped the scraper, the AI prompts and every
`process.env` lookup into the browser bundle. Every visitor re-scraped all three
canteens themselves, and no feature that needed a secret could work at all.
Everything server-side now sits behind `/api`.

## How it fits together

```
        twice daily (06:00 and 09:00 UTC, Mon–Fri)
                        │
                        ▼
        ┌───────────────────────────────┐
        │  api/cron/update.ts           │   the only writer
        │   1. scrape 3 canteen widgets │
        │   2. ask Gemini for origins,  │
        │      descriptions, plates     │
        │   3. upsert the week          │
        └───────────────┬───────────────┘
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
   Supabase Postgres            Supabase Storage
   weekly_menus                 plate images
   dish_cache                   (dish-addressed)
   canteen_attendance
          │
          ▼
   ┌──────────────┐     ┌─────────────────────────┐
   │  /api/*      │◀────│  React SPA (Vite +      │
   │  functions   │     │  TanStack Router)       │
   └──────────────┘     └─────────────────────────┘
          │
          ▼
    Upstash Redis (optional cache)
    Gemini · kassal.app · meny.no · Slack
```

The menu is scraped from each canteen's InSign display widget — the same screen
that hangs in the canteen — which is HTML meant for a TV, not an API. Most of
`scraper.service.ts` is about surviving that.

## Stack

| Piece | Choice |
| --- | --- |
| App | React 19 + Vite, TanStack Router / Query / Store, plain CSS |
| Server | Vercel Functions under `api/`, thin wrappers over `src/server/*` |
| Database | Supabase Postgres (`supabase/schema.sql`) |
| Images | Supabase Storage, generated with Gemini and background-removed |
| Cache | Upstash Redis, optional everywhere |
| Schedule | Vercel Cron (`vercel.json`) |

It is a PWA: `public/manifest.json` plus the iOS meta tags in `index.html`, and
it is used installed on an Android home screen, so safe-area insets and standalone
display are real constraints rather than nice-to-haves.

### Why Vercel Cron and not GitHub Actions

GitHub disables scheduled workflows after 60 days without repository activity,
and this repo intentionally goes quiet — the menu lives in Supabase, not in git.
The updater moved to Vercel Cron, which has no such rule. CI still runs on
GitHub, because push and pull_request triggers are never disabled.

## Running it locally

```bash
npm install
cp .env.example .env      # then fill it in — every variable is documented there
npm run dev               # http://localhost:5173
```

`npm run dev` serves the `api/` functions too: a plugin in `vite.config.ts`
loads the same handler modules through Vite's SSR pipeline and adapts Node's
req/res to the slice of the Vercel signature they use, so endpoint edits
hot-reload and no `vercel dev` is needed.

The client itself needs no environment: the two public Supabase values have
hardcoded fallbacks in `src/lib/constants.ts`, which is why the client build
works with nothing set. The functions are what read `.env`.

To run the pipeline by hand — after a prompt change, to backfill a week, or to
debug a scrape without waiting for the schedule:

```bash
npm run update                    # scrape, enrich, persist; reuse cached dishes
npm run update -- --force         # re-ask the model and rebuild every image
npm run update -- --week 2026-W34 # a specific week
```

`--force` costs real money — it regenerates every plate. `--week` writes to the
week you name, so a typo overwrites a real one.

This writes to the same Supabase the deployed app reads, so it needs the write
credentials — `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` — in `.env`, not
just the two public values. Without the service-role key it refuses to run
rather than falling back to the anon key, and says so.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `tsr generate` then `vite build` into `dist/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm test` | `node --test` over `src/**/*.test.ts` |
| `npm run update` | The weekly updater, run locally |

CI runs typecheck, lint, test and build on every pull request and every push to
main.

## Which week you see

`computeDisplayContext` in `src/lib/dateUtils.ts` is the single source of truth,
and it has four modes:

| Mode | When | What it does |
| --- | --- | --- |
| `weekday-current` | Mon–Fri | Lands on today, "Dagens Lunsj", voting on |
| `weekend-preview` | Sat/Sun, next week published | Dates shift +7, lands on Monday, "Neste ukes Lunsj", voting off |
| `weekend-recap` | Sat/Sun, next week not out yet | Stays on the week just ended, lands on Friday, "kantinene er stengt" |
| `pinned-week` | `?week=2026-W35` | Shows that week, says so in the day bar |

The mode is chosen from the week each canteen's **own label** claims, not from
the row it was stored in. That is why the read path serves next week's row from
Saturday (`readWeekForDisplay`): without it the client only ever sees
current-week labels and preview cannot trigger.

This is worth knowing before touching the updater's week routing. Preview used
to work by accident — the updater wrote every canteen into the current week's
row regardless of what it published, so a rolled-over kitchen put next-week
labels in this week's row. Routing each canteen to the week it actually
publishes fixed a real data-loss bug and silently killed the preview with it.
The two are coupled; change one and check the other.

A canteen that has not published next week yet is simply absent from that row.
The preview banner names it, so a missing card reads as "not out yet".

## Endpoints

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/menu` | GET | The stored week. `?week=2026-W34` pins one. CDN-cached. |
| `/api/attendance` | GET / POST | Today's vote tally, and casting a vote |
| `/api/recipe` | POST | AI recipe for a dish |
| `/api/meny` | POST | meny.no product search for its ingredients |
| `/api/deals` | POST | kassal.app grocery prices |
| `/api/notify` | POST | Posts the lunch vote result to Slack |
| `/api/cron/update` | GET | The updater. Requires `Authorization: Bearer $CRON_SECRET` |

Every file under `api/` that imports from `src/server` must use **`.js`
specifiers** on relative imports. Node's ESM resolver requires the extension at
runtime; omit it and the build stays green while every function dies on
invocation.

## Database

`supabase/schema.sql` describes what is actually deployed and is safe to re-run
against a live database — every statement is idempotent.

| Table | Contents |
| --- | --- |
| `weekly_menus` | One row per ISO week, keyed `2026-W34` |
| `dish_cache` | One row per distinct dish: origin, description, plate path, retry counters |
| `canteen_attendance` | One row per canteen per day, with `cast_attendance_vote()` |

`dish_cache` is what keeps the twice-daily cron from re-billing the model for
dishes it has already seen: a dish means the same thing in every week it
appears, so its origin, description and plate are produced once and reused.

The app only ever SELECTs. Every writer — the cron updater and the maintenance
scripts — authenticates with the service-role key, which bypasses RLS, so the
tables carry read policies and no write policies at all.

## Deploying

Pushes to `main` auto-deploy. The environment variables in `.env.example` must
exist on the Vercel project; several features fail silently without them, and
each one says so in that file.

A green build is not evidence that anything runs. The functions, the cron and
the data are all separately capable of being broken behind a successful
deployment — check the endpoint, the runtime log and the stored row.
