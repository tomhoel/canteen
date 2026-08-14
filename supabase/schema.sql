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

-- ── Weekly menus ──────────────────────────────────────────────────────────
-- One row per ISO week, keyed "2026-W34". menu_data additionally carries a
-- `fingerprint` field the updater uses to skip enrichment when a re-scrape is
-- identical to what is already stored.
CREATE TABLE IF NOT EXISTS public.weekly_menus (
    week_id           TEXT PRIMARY KEY,
    menu_data         JSONB NOT NULL,
    dish_origins      JSONB DEFAULT '{}'::jsonb,
    dish_descriptions JSONB DEFAULT '{}'::jsonb,
    scraped_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

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
