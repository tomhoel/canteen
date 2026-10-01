# Canteen

The lunch menu for three workplace canteens — **Eat the street**, **Fresh4you**
and **Flow** — as an installable phone app. It shows the week's dishes in
Norwegian or English, a plate photo for each day's main dish, where the dish
comes from, a recipe for it, grocery prices for its ingredients, and a vote for
where people are eating today.

Production: <https://fbueat.vercel.app>

## The one rule

**A page view never scrapes anything.** The canteens are scraped, enriched and
photographed twice a day by a cron job that writes to Upstash Redis and Vercel
Blob; the app only ever reads what is already stored.

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
        │   3. store the week           │
        │   4. publish the response     │
        └───────────────┬───────────────┘
                        │
          ┌─────────────┴──────────────┐
          ▼                            ▼
   Upstash Redis                Vercel Blob
   menu:<week>, dish_cache      plates (+ 512px thumbs),
   attendance:<date>, caches    menu-response/current.json
          │                            │
          ▼                            ▼
   ┌──────────────┐     ┌─────────────────────────┐
   │  /api/*      │◀────│  React SPA (Vite)       │
   │  functions   │     │  reads the static menu  │
   └──────────────┘     │  file Mon–Fri, /api/menu│
          │             │  at weekends            │
          ▼             └─────────────────────────┘
    Gemini · kassal.app · meny.no · Slack
```

The menu is scraped from each canteen's InSign display widget — the same screen
that hangs in the canteen — which is HTML meant for a TV, not an API. Most of
`scraper.service.ts` is about surviving that.

## Stack

| Piece | Choice |
| --- | --- |
| App | React 19 + Vite, TanStack Query, plain CSS |
| Server | Vercel Functions under `api/`, thin wrappers over `src/server/*` |
| Data | Upstash Redis: stored weeks, `dish_cache`, attendance, response caches |
| Images | Vercel Blob, generated with Gemini and background-removed; each plate has a 512px thumb under `images_nobg/thumb/` |
| Schedule | Vercel Cron (`vercel.json`) |

It is a PWA: `public/manifest.json` plus the iOS meta tags in `index.html`, and
it is used installed on an Android home screen, so safe-area insets and standalone
display are real constraints rather than nice-to-haves.

### Why Vercel Cron and not GitHub Actions

GitHub disables scheduled workflows after 60 days without repository activity,
and this repo intentionally goes quiet — the menu lives in Redis, not in git.
The updater moved to Vercel Cron, which has no such rule. CI still runs on
GitHub, because push and pull_request triggers are never disabled.

## Running it locally

> **If your clone predates 14 September 2026, delete it and clone again.**
> History was rewritten that day (`git filter-repo`) to drop 668 image blobs
> that had already been deleted from the tree but were still costing every
> clone 478 MB — the pack went from 488 MiB to 10.3 MiB. No file content
> changed; the HEAD tree hash is identical either side. But every commit has a
> new SHA, so `git pull` cannot reconcile an older clone and will either refuse
> or produce a duplicated history. Two branches could not survive and were
> deleted: `feat/canteen-metadata-campus-map` (already merged, empty) and
> `experiment/preact` (superseded — the bundle was never the bottleneck).

```bash
npm install
cp .env.example .env      # then fill it in — every variable is documented there
npm run dev               # http://localhost:5173
```

`npm run dev` serves the `api/` functions too: a plugin in `vite.config.ts`
loads the same handler modules through Vite's SSR pipeline and adapts Node's
req/res to the slice of the Vercel signature they use, so endpoint edits
hot-reload and no `vercel dev` is needed.

The client itself needs no environment: the Blob base URL has a hardcoded
fallback in `src/lib/constants.ts`, which is why the client build works with
nothing set. The functions are what read `.env`.

To run the pipeline by hand — after a prompt change, to backfill a week, or to
debug a scrape without waiting for the schedule:

```bash
npm run update                    # scrape, enrich, persist; reuse cached dishes
npm run update -- --force         # re-ask the model and rebuild every image
npm run update -- --week 2026-W34 # a specific week
```

`--force` costs real money — it regenerates every plate. `--week` writes to the
week you name, so a typo overwrites a real one.

This writes to the same Redis and Blob the deployed app reads, so it needs
`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, `BLOB_READ_WRITE_TOKEN`
and `GEMINI_API_KEY` in `.env`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | `vite build` into `dist/` |
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

## Data

Everything lives in Upstash Redis and Vercel Blob. There is no SQL database:
Supabase was the original store, was migrated away from, and nothing at runtime
reads it any more. `supabase/schema.sql` and the `migrate-*`/`backup-supabase`
scripts are kept as the record of that schema and move.

| Key / path | Contents |
| --- | --- |
| `menu:<week>` / `menu:weeks` | One record per ISO week (`2026-W34`) and the sorted index of weeks |
| `dish_cache` (hash) | One entry per distinct dish: origin, description, plate path, retry counters |
| `attendance:<date>` | Votes per canteen per day |
| `response:menu:v5:*` | Short-lived caches of the `/api/menu` response |
| Blob `images_nobg/archive/*` | Plates, addressed by dish; `images_nobg/thumb/*` holds the 512px card thumbs |
| Blob `menu-response/current.json` | The finished `/api/menu` response, rewritten by every cron run |

`dish_cache` is what keeps the twice-daily cron from re-billing the model for
dishes it has already seen: a dish means the same thing in every week it
appears, so its origin, description and plate are produced once and reused.

**First load.** Monday to Friday (Europe/Oslo) the page reads
`menu-response/current.json` directly: no function, so no cold start. At
weekends it uses `/api/menu`, because the live endpoint switches to next week at
Saturday 00:00 with no cron run to rewrite the file. A missing file falls back
to `/api/menu`. A returning visitor is painted from `localStorage` at once and
the fresh response replaces it when it arrives.

Any plate written outside `uploadToStorage` has no thumb; run
`node --env-file=.env scripts/backfill-thumbs.cjs` (idempotent).

## Deploying

Pushes to `main` auto-deploy. The environment variables in `.env.example` must
exist on the Vercel project; several features fail silently without them, and
each one says so in that file.

A green build is not evidence that anything runs. The functions, the cron and
the data are all separately capable of being broken behind a successful
deployment — check the endpoint, the runtime log and the stored row.
