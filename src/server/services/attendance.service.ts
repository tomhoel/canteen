import { createClient } from "@supabase/supabase-js";
import { Redis } from "@upstash/redis";
import { getLocalDateKey } from "../../lib/dateUtils.ts";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getRedis() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return null;
}

export async function submitVoteService(canteenId: string) {
  const dateKey = getLocalDateKey();
  const canteensResult: Record<string, number> = {};

  const supabase = getSupabase();
  if (supabase) {
    try {
      const { data: existing } = await supabase
        .from("canteen_attendance")
        .select("vote_count")
        .eq("vote_date", dateKey)
        .eq("canteen_name", canteenId)
        .maybeSingle();

      const newCount = (existing?.vote_count || 0) + 1;

      await supabase.from("canteen_attendance").upsert(
        {
          vote_date: dateKey,
          canteen_name: canteenId,
          vote_count: newCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "vote_date,canteen_name" }
      );

      const { data: allVotes } = await supabase
        .from("canteen_attendance")
        .select("canteen_name, vote_count")
        .eq("vote_date", dateKey);

      (allVotes || []).forEach((row) => {
        canteensResult[row.canteen_name] = row.vote_count;
      });

      const redis = getRedis();
      if (redis) {
        await redis.set(`attendance:${dateKey}`, {
          date: dateKey,
          canteens: canteensResult,
        });
      }

      return { success: true, canteens: canteensResult };
    } catch (err) {
      console.error("Supabase vote submit error:", err);
    }
  }

  const redis = getRedis();
  if (redis) {
    try {
      const redisKey = `attendance:${dateKey}`;
      const current = (await redis.get<{
        date: string;
        canteens: Record<string, number>;
      }>(redisKey)) || { date: dateKey, canteens: {} };

      current.canteens[canteenId] = (current.canteens[canteenId] || 0) + 1;
      await redis.set(redisKey, current);
      return { success: true, canteens: current.canteens };
    } catch (err) {
      console.error("Redis vote submit error:", err);
    }
  }

  canteensResult[canteenId] = 1;
  return { success: true, canteens: canteensResult };
}
