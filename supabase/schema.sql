-- Canteen database schema (Supabase / PostgreSQL)
--
-- This file describes what is actually deployed. The previous version drifted:
-- it declared a `canteen_attendance` table that was never created (votes live
-- in Upstash Redis), omitted `dish_cache` entirely, and its policies were
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
    cache_key       VARCHAR PRIMARY KEY,
    original_name   TEXT,
    clean_name      TEXT,
    origin          JSONB,
    description     JSONB,
    image_path      TEXT,
    image_nobg_path TEXT,
    first_seen      TIMESTAMPTZ DEFAULT NOW()
);

-- ── Row level security ────────────────────────────────────────────────────
ALTER TABLE public.weekly_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_cache   ENABLE ROW LEVEL SECURITY;

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

-- Intentionally no INSERT/UPDATE/DELETE policies: writes are service-role only.
