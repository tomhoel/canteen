-- Canteen Database Schema for Supabase PostgreSQL

-- 1. Weekly Menus Table
CREATE TABLE IF NOT EXISTS public.weekly_menus (
    week_id TEXT PRIMARY KEY,
    menu_data JSONB NOT NULL,
    dish_origins JSONB DEFAULT '{}'::jsonb,
    dish_descriptions JSONB DEFAULT '{}'::jsonb,
    scraped_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on week_id for fast lookup
CREATE INDEX IF NOT EXISTS idx_weekly_menus_week_id ON public.weekly_menus (week_id);

-- 2. Canteen Attendance Voting Table
CREATE TABLE IF NOT EXISTS public.canteen_attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vote_date DATE NOT NULL,
    canteen_name TEXT NOT NULL,
    vote_count INT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (vote_date, canteen_name)
);

-- Index on vote_date for historical queries
CREATE INDEX IF NOT EXISTS idx_canteen_attendance_date ON public.canteen_attendance (vote_date);

-- Enable RLS (Row Level Security) with public read access
ALTER TABLE public.weekly_menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canteen_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access for weekly_menus" 
    ON public.weekly_menus FOR SELECT 
    USING (true);

CREATE POLICY "Allow public read access for canteen_attendance" 
    ON public.canteen_attendance FOR SELECT 
    USING (true);

CREATE POLICY "Allow service role write access for weekly_menus" 
    ON public.weekly_menus FOR ALL 
    USING (true);

CREATE POLICY "Allow service role write access for canteen_attendance" 
    ON public.canteen_attendance FOR ALL 
    USING (true);
