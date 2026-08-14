import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendSlackNotification } from "../src/server/notify.js";
import { methodNotAllowed, readJsonBody, respond } from "./_lib/handler.js";

/** Posts the lunch vote result to Slack. Keeps SLACK_WEBHOOK_URL server-side. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  return respond(res, () => sendSlackNotification(readJsonBody(req) as any));
}
