/**
 * Where plate images and the published menu files are served from: the public
 * object URL of the "canteen" Supabase project's Storage.
 *
 * One definition for everyone: the client bundle (vite.config.ts defines
 * process.env.NEXT_PUBLIC_STORAGE_BASE_URL from this), index.html (the same
 * plugin fills its placeholders) and the server. Override with the env var to
 * point at another store; the object layout is `<base>/<bucket>/<path>`.
 *
 * History: the files lived in Vercel Blob until 2026-10-01, when the free
 * plan's monthly write allowance ran out and the store was suspended for a
 * month (reads included). Supabase Storage has no write cap on the free plan.
 */
export const DEFAULT_STORAGE_BASE_URL =
  "https://wuwiiktwvugqtslsogxr.supabase.co/storage/v1/object/public";

export const STORAGE_BASE_URL = process.env.NEXT_PUBLIC_STORAGE_BASE_URL || DEFAULT_STORAGE_BASE_URL;
