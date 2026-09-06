import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAttendanceHistory, submitVote } from "../src/server/attendance.js";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler.js";

/** GET returns the vote history; POST casts a vote for a canteen. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") {
    // This endpoint set no Cache-Control at all, so Vercel defaulted to
    // `max-age=0, must-revalidate` and every single page load paid a full
    // origin round trip — measured at ~520ms for a 218-byte body, on a path
    // where nothing else about the response changes second to second.
    //
    // The body is a fortnight of daily vote aggregates. 30 seconds of edge
    // staleness is invisible: a voter's own vote is applied optimistically by
    // useVoting and never waits on this, and the leaderboard is a two-week
    // trend. `stale-while-revalidate` then means nobody ever waits for the
    // refresh either.
    //
    // POST deliberately keeps no caching — it is the write.
    res.setHeader(
      "Cache-Control",
      "public, max-age=0, s-maxage=30, stale-while-revalidate=300"
    );
    return respond(res, () => getAttendanceHistory());
  }
  if (req.method === "POST") return respond(res, () => submitVote(readJsonBody(req) as any));
  return methodNotAllowed(res, ["GET", "POST"]);
}
