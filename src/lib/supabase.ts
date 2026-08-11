import { createClient } from "@supabase/supabase-js";
import ws from "ws";

// Hardcoded fallbacks match src/lib/constants.ts so the app keeps working
// even when Vercel's NEXT_PUBLIC_SUPABASE_* env vars aren't set at build time.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://sloutnqpqfesyoycklgd.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsb3V0bnFwcWZlc3lveWNrbGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NzQ2NzYsImV4cCI6MjA5MzU1MDY3Nn0.8QQbCvzFkZzQjJUEYBhBxAHJ-wgf-tfFyj5i-3sUfdo";

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false },
  realtime: { transport: ws as any },
});

export function getSupabaseImageUrl(bucket: string, filePath: string, options?: { width?: number; format?: string }): string {
  if (!supabaseUrl) return "";
  let url = `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
  if (options && (options.width || options.format)) {
    const params = new URLSearchParams();
    if (options.width) params.set("width", options.width.toString());
    if (options.format) params.set("format", options.format);
    url += `?${params.toString()}`;
  }
  return url;
}

export function getClosedPlateUrl(key: string, options?: { width?: number; format?: string }): string {
  return getSupabaseImageUrl("images_nobg", "closed-plates/closed-plate-1.png", options);
}
