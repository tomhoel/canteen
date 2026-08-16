import { createClient } from "@supabase/supabase-js";
import { getLocalDateKey } from "../../lib/dateUtils.js";

/**
 * Where the lunch vote lives.
 *
 * It used to live nowhere. This service wrote to `public.canteen_attendance`,
 * a table that was never created — the schema file declared it, the database
 * never had it. supabase-js reports a missing relation as `{ data: null, error }`
 * rather than throwing, and the code here destructured only `data`, so a read,
 * an upsert and a re-read all failed in silence and the function returned
 * `{ success: true, canteens: {} }`. Everything downstream believed it: the
 * endpoint answered 200, and the client replaced its optimistic count with the
 * empty tally, so the number appeared and vanished again on the same tap.
 *
 * There was a Redis fallback for exactly this situation, but it sat after the
 * `return` inside the `if (supabase)` branch, so it only ran when Supabase threw
 * — which is the one thing supabase-js does not do.
 *
 * The table exists now (supabase/schema.sql). The rules here are the lesson:
 * every `error` is inspected, and a vote that was not stored throws. An empty
 * tally means nobody has voted yet, and must never be how a failure looks.
 */

/** The window the leaderboard renders: today plus the previous 13 days. */
export const HISTORY_DAYS = 14;

const TABLE = "canteen_attendance";

export interface HistoryEntry {
  /** Oslo calendar day, `YYYY-MM-DD`. */
  date: string;
  canteens: Record<string, number>;
}

interface VoteRow {
  vote_date: string;
  canteen_name: string;
  vote_count: number;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Writes need the service role: the table carries a read policy and no write
  // policies, so the anon key can count votes but never cast one.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function requireSupabase() {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error(
      "Vote storage is not configured: NEXT_PUBLIC_SUPABASE_URL and a Supabase key " +
        "must be set on this deployment."
    );
  }
  return supabase;
}

/**
 * Records one vote and returns the day's tally as the database now holds it.
 *
 * The increment is a single RPC rather than read-add-write. Lunch votes arrive
 * in a burst over a few minutes, and two clients reading `2` and both writing
 * `3` is not a hypothetical — it is the normal case at 11:00. `ON CONFLICT DO
 * UPDATE SET vote_count = vote_count + 1` is the only place that arithmetic is
 * safe, and the same statement hands back every canteen for the day, so the
 * caller needs no second round trip.
 */
export async function submitVoteService(canteenId: string) {
  const supabase = requireSupabase();
  const dateKey = getLocalDateKey();

  const { data, error } = await supabase.rpc("cast_attendance_vote", {
    p_date: dateKey,
    p_canteen: canteenId,
  });

  if (error) {
    throw new Error(`Vote could not be recorded: ${error.message}`);
  }

  const canteens: Record<string, number> = {};
  for (const row of (data ?? []) as Array<Pick<VoteRow, "canteen_name" | "vote_count">>) {
    canteens[row.canteen_name] = row.vote_count;
  }

  return { success: true as const, canteens };
}

/**
 * The last `days` days of tallies, newest day first.
 *
 * Sorted here rather than trusted from the query: the grouping collapses the
 * flat rows into one entry per day, and the leaderboard's per-day dots read in
 * order. One wrong assumption about row order would reverse the timeline
 * without failing anything.
 */
export async function getAttendanceHistoryService(
  days: number = HISTORY_DAYS
): Promise<{ entries: HistoryEntry[] }> {
  const supabase = requireSupabase();
  const since = new Date(
    Date.parse(`${getLocalDateKey()}T00:00:00Z`) - (days - 1) * 86_400_000
  )
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from(TABLE)
    .select("vote_date, canteen_name, vote_count")
    .gte("vote_date", since)
    .order("vote_date", { ascending: false });

  if (error) {
    throw new Error(`Vote history could not be read: ${error.message}`);
  }

  const byDate = new Map<string, Record<string, number>>();
  for (const row of (data ?? []) as VoteRow[]) {
    const day = byDate.get(row.vote_date) ?? {};
    day[row.canteen_name] = row.vote_count;
    byDate.set(row.vote_date, day);
  }

  const entries = [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, canteens]) => ({ date, canteens }));

  return { entries };
}
