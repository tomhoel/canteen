import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { putObject, objectExists, publicUrl, keepProjectAlive } from "./storage.service";

/**
 * The storage module is plain REST over fetch, so these stub fetch and pin what is
 * sent and how each answer is read. The cases that matter are the failure ones: a
 * missing object must read as "no", anything else the module cannot interpret must
 * read as "cannot tell", because the image pass draws (and pays for) a plate only
 * when told "no".
 */

type Call = { url: string; init: RequestInit };

function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  });
  return calls;
}

test.afterEach(() => {
  mock.restoreAll();
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test("publicUrl - encodes each path segment but keeps the slashes", () => {
  const url = publicUrl("images_nobg", "archive/stekt sei med erter.png");
  assert.match(url, /\/images_nobg\/archive\/stekt%20sei%20med%20erter\.png$/);
});

test("putObject - posts the bytes with the key, upsert and a cache lifetime", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const calls = stubFetch(() => new Response("{}", { status: 200 }));

  await putObject("images_nobg", "thumb/archive/a b.png", Buffer.from("x"), "image/webp", 3600);

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/storage\/v1\/object\/images_nobg\/thumb\/archive\/a%20b\.png$/);
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(calls[0].init.method, "POST");
  assert.equal(h.authorization, "Bearer service-key");
  assert.equal(h["x-upsert"], "true", "a redraw must replace the object");
  assert.equal(h["cache-control"], "max-age=3600");
  assert.equal(h["content-type"], "image/webp");
});

test("putObject - a refusal throws with the status and the server's reason", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  stubFetch(() => new Response('{"message":"Bucket not found"}', { status: 404 }));
  await assert.rejects(putObject("nope", "a.png", "x", "image/webp", 1), /HTTP 404.*Bucket not found/);
});

test("putObject - without the service key it fails before any request", async () => {
  const calls = stubFetch(() => new Response("{}"));
  await assert.rejects(putObject("images_nobg", "a.png", "x", "image/webp", 1), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(calls.length, 0);
});

test("objectExists - 200 is yes, 400 and 404 are no (Supabase uses both for a missing object)", async () => {
  stubFetch(() => new Response(null, { status: 200 }));
  assert.equal(await objectExists("images_nobg", "a.png"), true);
  mock.restoreAll();
  stubFetch(() => new Response("{}", { status: 400 }));
  assert.equal(await objectExists("images_nobg", "a.png"), false);
  mock.restoreAll();
  stubFetch(() => new Response("{}", { status: 404 }));
  assert.equal(await objectExists("images_nobg", "a.png"), false);
});

test("objectExists - a 403, a 5xx or a network error is 'cannot tell', never 'no'", async () => {
  for (const status of [403, 500, 503]) {
    stubFetch(() => new Response("{}", { status }));
    assert.equal(await objectExists("images_nobg", "a.png"), null, `HTTP ${status}`);
    mock.restoreAll();
  }
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed");
  });
  assert.equal(await objectExists("images_nobg", "a.png"), null, "network error");
});

test("keepProjectAlive - writes one row to the keepalive table with the service key", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const calls = stubFetch(() => new Response(null, { status: 201 }));

  await keepProjectAlive();

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/keepalive\?on_conflict=id$/);
  assert.equal((calls[0].init.headers as Record<string, string>).prefer, "resolution=merge-duplicates,return=minimal");
  assert.equal(JSON.parse(String(calls[0].init.body)).id, 1);
});

test("keepProjectAlive - does nothing without a key, and reports a failed write", async () => {
  const calls = stubFetch(() => new Response("{}", { status: 401 }));
  await keepProjectAlive();
  assert.equal(calls.length, 0, "no key, no request");

  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  await assert.rejects(keepProjectAlive(), /HTTP 401/);
});
