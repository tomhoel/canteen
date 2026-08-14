import type { VercelRequest, VercelResponse } from "@vercel/node";
import { generateRecipe } from "../src/server/recipe.js";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler.js";

/** AI recipe for a dish. Keeps GEMINI_API_KEY server-side. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  return respond(res, () => generateRecipe(readJsonBody(req) as any));
}
