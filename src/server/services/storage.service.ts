import { STORAGE_BASE_URL } from "../../lib/storage-url.js";

/**
 * Object storage (Supabase Storage) for plate images and the published menu
 * files. Writes need SUPABASE_SERVICE_ROLE_KEY; reads are plain public URLs.
 *
 * Replaces @vercel/blob, whose free plan counts every write against a monthly
 * allowance of 2,000 and suspends the whole store, reads included, when it runs
 * out (2026-10-01). A plain REST call is also all this needs: three functions.
 */

const encode = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const apiRoot = () => `${new URL(STORAGE_BASE_URL).origin}/storage/v1/object`;

/** The public URL of an object. */
export const publicUrl = (bucket: string, path: string) => `${STORAGE_BASE_URL}/${bucket}/${encode(path)}`;

/** Creates or replaces an object. Throws on failure, with the server's reason. */
export async function putObject(
  bucket: string,
  path: string,
  body: Buffer | string,
  contentType: string,
  maxAgeSeconds: number
): Promise<void> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  const res = await fetch(`${apiRoot()}/${bucket}/${encode(path)}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      apikey: key,
      "content-type": contentType,
      "cache-control": `max-age=${maxAgeSeconds}`,
      "x-upsert": "true",
    },
    body: typeof body === "string" ? body : new Uint8Array(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`upload of ${bucket}/${path} failed: HTTP ${res.status} ${detail}`);
  }
}

/**
 * Whether an object exists: true / false, or null when it cannot be told (a
 * network error, a 5xx), which a caller must not read as "no". Supabase answers
 * a missing object with 400 or 404 depending on the route.
 */
export async function objectExists(bucket: string, path: string): Promise<boolean | null> {
  try {
    const res = await fetch(publicUrl(bucket, path), { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    if (res.ok) return true;
    return res.status === 404 || res.status === 400 ? false : null;
  } catch {
    return null;
  }
}
