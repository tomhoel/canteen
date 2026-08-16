-- Canteen database schema (Supabase / PostgreSQL)
--
-- This file describes what is actually deployed. The previous version drifted:
-- it declared a `canteen_attendance` table that was never created (see below —
-- it exists now), omitted `dish_cache` entirely, and its policies were
-- written as `FOR ALL USING (true)` — which grants the public anon role write
-- access, not the service role. In practice RLS was simply switched off, so
-- anyone holding the anon key (a public credential, and one that was committed
-- to this repo) could rewrite or delete every menu.
--
-- The rule now: the app only ever SELECTs, and every writer — the cron updater
-- and the maintenance scripts — authenticates with the service-role key, which
-- bypasses RLS. So the tables need read policies and no write policies at all.
--
-- This file is safe to re-run against a live database, and is meant to be. Every
-- statement is idempotent, and the ALTERs below the CREATEs exist because
-- `CREATE TABLE IF NOT EXISTS` silently does nothing on a table that already
-- exists — so a column added here would never reach a deployed database, and the
-- file would quietly go back to describing something that isn't there.

-- ── Weekly menus ──────────────────────────────────────────────────────────
-- One row per ISO week, keyed "2026-W34". menu_data additionally carries a
-- `fingerprint` field the updater uses to skip enrichment when a re-scrape is
-- identical to what is already stored.
CREATE TABLE IF NOT EXISTS public.weekly_menus (
    week_id           TEXT PRIMARY KEY,
    menu_data         JSONB NOT NULL,
    dish_origins      JSONB DEFAULT '{}'::jsonb,
    dish_descriptions JSONB DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    scraped_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Reconciles a database created before these columns existed. The table shipped
-- with only week_id, created_at, menu_data, dish_origins and dish_descriptions,
-- while the updater's upsert names scraped_at — so every write failed with
-- PGRST204 ("Could not find the 'scraped_at' column ... in the schema cache")
-- until these ran. created_at is listed above because the live table has it, not
-- because anything writes it: it records the first insert and never moves, which
-- is why it cannot answer "when was this week last refreshed".
ALTER TABLE public.weekly_menus ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.weekly_menus ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.weekly_menus ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ADD COLUMN ... DEFAULT NOW() stamps every pre-existing row with the migration
-- time, which would claim each archived week was scraped the day this ran. The
-- real timestamp was being written inside the JSON all along, so recover it and
-- only fall back to the default where that key is absent.
--
-- jsonb_exists(...) rather than the `?` operator: `?` is a bind placeholder in
-- most Postgres drivers, so the operator form makes this file unrunnable outside
-- a raw psql session. The final predicate makes a re-run a genuine no-op, which
-- matters now that the trigger below would otherwise bump updated_at each time.
UPDATE public.weekly_menus
   SET scraped_at = (menu_data->>'scrapedAt')::timestamptz
 WHERE jsonb_exists(menu_data, 'scrapedAt')
   AND (menu_data->>'scrapedAt') <> ''
   AND scraped_at IS DISTINCT FROM (menu_data->>'scrapedAt')::timestamptz;

-- updated_at is maintained here rather than in the upsert payload, so it stays
-- honest even for a write that forgets it. Without this it would be pinned to
-- the insert and duplicate created_at, which is worse than not having it.
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS weekly_menus_touch_updated_at ON public.weekly_menus;
CREATE TRIGGER weekly_menus_touch_updated_at
    BEFORE UPDATE ON public.weekly_menus
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Dish cache ────────────────────────────────────────────────────────────
-- One row per distinct dish, keyed by its normalised name. A dish means the
-- same thing in every week it appears, so its origin, description and plate
-- image are produced once and reused forever. This is what keeps the twice-
-- daily cron from re-billing the model for dishes it has already seen.
CREATE TABLE IF NOT EXISTS public.dish_cache (
    cache_key           VARCHAR PRIMARY KEY,
    original_name       TEXT,
    clean_name          TEXT,
    origin              JSONB,
    description         JSONB,
    image_path          TEXT,
    image_nobg_path     TEXT,
    first_seen          TIMESTAMPTZ DEFAULT NOW(),
    enrich_attempts     INTEGER DEFAULT 0,
    last_enrich_attempt TIMESTAMPTZ
);

-- Bounded retries for dishes the model never answers for.
--
-- A fallback origin/description is deliberately never persisted here: a cache
-- hit means the dish is never asked about again, so storing canned copy would
-- bake one rate-limited afternoon in permanently. The cost of that rule is that
-- such a dish is re-sent on every run forever, and nothing reported it. These
-- columns are where the updater counts attempts so it can stop after
-- MAX_ENRICH_ATTEMPTS (src/server/services/dish-cache.service.ts) and say so in
-- the cron response.
--
-- Nullable with a default rather than NOT NULL: PostgREST fills any column
-- listed in a bulk upsert that a given row omits with NULL, so NOT NULL would
-- reject writes from callers that do not carry the counter — the image pass,
-- for one. Clearing these two columns for a dish is the supported way to make
-- the updater try it again before the cooldown elapses.
ALTER TABLE public.dish_cache ADD COLUMN IF NOT EXISTS enrich_attempts     INTEGER DEFAULT 0;
ALTER TABLE public.dish_cache ADD COLUMN IF NOT EXISTS last_enrich_attempt TIMESTAMPTZ;
UPDATE public.dish_cache SET enrich_attempts = 0 WHERE enrich_attempts IS NULL;

-- ── Attendance votes ──────────────────────────────────────────────────────
-- One row per canteen per day. The app has always written here; the table is
-- what was missing. Votes were meant to live in Upstash Redis instead, and
-- never did: src/server/services/attendance.service.ts reached for this table
-- first and only fell back to Redis if Supabase *threw*, which supabase-js does
-- not do for a missing relation. Every vote ever cast was silently discarded.
-- Votes live here now, and that fallback is gone.
--
-- A composite primary key rather than a surrogate id: one canteen has exactly
-- one count on a given day, and saying so in the key is what makes the upsert
-- below safe to repeat.
CREATE TABLE IF NOT EXISTS public.canteen_attendance (
    vote_date    DATE    NOT NULL,
    canteen_name TEXT    NOT NULL,
    vote_count   INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (vote_date, canteen_name)
);

-- The leaderboard reads a trailing 14-day window on every open, and the primary
-- key's leading column already orders by date — but the query filters on it
-- alone, so give it an index that matches the shape it actually asks for.
CREATE INDEX IF NOT EXISTS canteen_attendance_recent
    ON public.canteen_attendance (vote_date DESC);

-- Casting a vote, in one statement.
--
-- The service used to SELECT the count, add one in JavaScript and write it
-- back. Lunch votes arrive in a burst just before 11:00, so two clients reading
-- the same number and storing the same increment is the normal case, not a rare
-- race — the second vote overwrote the first. Postgres is the only place that
-- addition can be atomic, and returning the whole day from the same call saves
-- the caller a second round trip.
--
-- Not SECURITY DEFINER: the only caller is the API function, which holds the
-- service-role key. Leaving it INVOKER means the anon key cannot vote by
-- calling the RPC directly, which is the same boundary the missing write
-- policies draw.
--
-- `#variable_conflict use_column` is load-bearing, not decoration. RETURNS TABLE
-- declares `canteen_name` and `vote_count` as OUT variables, and PL/pgSQL then
-- refuses the ON CONFLICT target with "column reference canteen_name is
-- ambiguous" — the function creates fine and fails only when first called. The
-- directive tells it to read those names as columns. Renaming the OUT variables
-- would work too, but they are the JSON keys PostgREST hands the client.
CREATE OR REPLACE FUNCTION public.cast_attendance_vote(p_date DATE, p_canteen TEXT)
RETURNS TABLE (canteen_name TEXT, vote_count INTEGER)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
BEGIN
    INSERT INTO public.canteen_attendance AS a (vote_date, canteen_name, vote_count, updated_at)
    VALUES (p_date, p_canteen, 1, NOW())
    ON CONFLICT (vote_date, canteen_name)
    DO UPDATE SET vote_count = a.vote_count + 1, updated_at = NOW();

    RETURN QUERY
    SELECT a.canteen_name, a.vote_count
      FROM public.canteen_attendance a
     WHERE a.vote_date = p_date;
END;
$$;

-- ── Row level security ────────────────────────────────────────────────────
ALTER TABLE public.weekly_menus       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_cache         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canteen_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_menus public read" ON public.weekly_menus;
CREATE POLICY "weekly_menus public read"
    ON public.weekly_menus
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "dish_cache public read" ON public.dish_cache;
CREATE POLICY "dish_cache public read"
    ON public.dish_cache
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "canteen_attendance public read" ON public.canteen_attendance;
CREATE POLICY "canteen_attendance public read"
    ON public.canteen_attendance
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- Intentionally no INSERT/UPDATE/DELETE policies: writes are service-role only.
