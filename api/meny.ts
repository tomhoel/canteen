import type { VercelRequest, VercelResponse } from "@vercel/node";
import { searchMeny } from "../src/server/meny.ts";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler.ts";

/** meny.no product search for a recipe's ingredients. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  return respond(res, () => searchMeny(readJsonBody(req) as any));
}
