import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchDeals } from "../src/server/deals.ts";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler.ts";

/** Grocery price lookup. Keeps KASSAL_API_KEY server-side. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  return respond(res, () => fetchDeals(readJsonBody(req) as any));
}
