/**
 * Tests for the cron's Slack alert, the one channel that tells anyone the
 * updater died. (The lunch-vote share that also posted here was removed.)
 */
import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendCronAlert } from "./notify.js";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";

interface Posted {
  url: string;
  body: any;
}

/** Stubs global fetch, recording what would have been posted. */
function stubSlack(response: { ok: boolean; status?: number; text?: string }) {
  const posted: Posted[] = [];
  mock.method(globalThis, "fetch", async (url: string, init: any) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 400),
      text: async () => response.text ?? "",
    } as Response;
  });
  return posted;
}

afterEach(() => {
  mock.restoreAll();
  delete process.env.SLACK_WEBHOOK_URL;
});

test("an alert is posted once, with its details as bullets", async () => {
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  const posted = stubSlack({ ok: true });

  const result = await sendCronAlert("error", "Weekly menu update failed", ["scrape timed out", "Flow: 0 days"]);

  assert.deepEqual(result, { ok: true });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, WEBHOOK);
  assert.match(posted[0].body.blocks[1].text.text, /• scrape timed out\n• Flow: 0 days/);
});

test("an alert Slack refuses reports skipped rather than throwing", async () => {
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  stubSlack({ ok: false, status: 403, text: "invalid_token" });

  assert.deepEqual(await sendCronAlert("warning", "t", ["d"]), { skipped: true });
});

test("an alert never throws, whatever Slack does", async () => {
  // sendCronAlert is called from the cron's failure handler. If it can throw it
  // turns a reported partial failure into an unreported total one.
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  mock.method(globalThis, "fetch", async () => {
    throw new Error("socket hang up");
  });

  const result = await sendCronAlert("error", "Weekly menu update failed", ["scrape timed out"]);
  assert.deepEqual(result, { skipped: true });
});

test("with no webhook configured, an alert skips silently", async () => {
  const posted = stubSlack({ ok: true });

  assert.deepEqual(await sendCronAlert("warning", "t", ["d"]), { skipped: true });
  assert.equal(posted.length, 0);
});
