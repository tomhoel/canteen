import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Shared plumbing for the JSON endpoints.
 *
 * Files under api/ that start with `_` are not deployed as functions, so this
 * module is private to the API layer.
 *
 * Each src/server entry point takes one payload object and returns a plain
 * object, so an endpoint is just: check the method, hand over the payload,
 * serialise the result. Errors become a 4xx/5xx with a message instead of an
 * unhandled rejection.
 */

type Json = Record<string, unknown>;

/** Thrown by handlers to signal a client error rather than a server fault. */
export class BadRequestError extends Error {
  readonly status = 400;
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]) {
  res.setHeader("Allow", allowed.join(", "));
  return res.status(405).json({ error: `Method not allowed. Use ${allowed.join(" or ")}.` });
}

/** Parses a JSON body whether Vercel pre-parsed it or handed us a raw string. */
export function readJsonBody(req: VercelRequest): Json {
  const { body } = req;
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as Json;
    } catch {
      throw new BadRequestError("Request body is not valid JSON.");
    }
  }
  return body as Json;
}

/** Reads a single query parameter, collapsing Vercel's string|string[] shape. */
export function queryParam(req: VercelRequest, name: string): string | undefined {
  const value = req.query?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.length > 0 ? first : undefined;
}

/**
 * Runs `work` and serialises the outcome.
 *
 * The upstream services throw plain Errors for invalid input ("Invalid
 * request", "Invalid canteenId"), so those map to 400; anything else is a
 * genuine 500 and is logged with its stack for the Vercel runtime log.
 */
export async function respond(
  res: VercelResponse,
  work: () => Promise<unknown>
): Promise<VercelResponse> {
  try {
    const result = await work();
    return res.status(200).json(result);
  } catch (err: any) {
    const message = err?.message ?? "Unexpected error";
    const status =
      err instanceof BadRequestError || /^invalid /i.test(message) ? 400 : 500;

    if (status === 500) {
      console.error("API handler failed:", err);
    } else {
      console.warn("API bad request:", message);
    }

    return res.status(status).json({ error: message });
  }
}
