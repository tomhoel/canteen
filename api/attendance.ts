import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAttendanceHistory, submitVote } from "../src/server/attendance";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler";

/** GET returns the vote history; POST casts a vote for a canteen. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return respond(res, () => getAttendanceHistory());
  if (req.method === "POST") return respond(res, () => submitVote(readJsonBody(req) as any));
  return methodNotAllowed(res, ["GET", "POST"]);
}
