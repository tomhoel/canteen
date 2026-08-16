/**
 * Tests for the Slack paths.
 *
 * Both of them reported failure the same opaque way, which is how a message
 * Slack refused and a webhook that no longer exists became indistinguishable —
 * on the one channel that tells anyone the updater died.
 *
 * The empty-tally case is not the edge case it looks like. `handleShareSlack`
 * posts whatever `votes` holds, and until the vote endpoint was fixed today it
 * returned `{}` for every vote ever cast. So every share this app has ever sent
 * built a section block with empty text, which Slack rejects outright, and came
 * back "Failed to send" — pointing at the webhook, which was fine all along.
 */
import test, { mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendSlackNotification, sendCronAlert } from "./notify.js";

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

test("a share with no votes yet never reaches Slack", () => {
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  const posted = stubSlack({ ok: true });

  return sendSlackNotification({ canteens: {}, date: "2026-08-17" }).then((result) => {
    assert.deepEqual(result, { skipped: true, reason: "no votes to share yet" });
    assert.equal(posted.length, 0, "an empty section block is a guaranteed 400");
  });
});

test("canteens sitting at zero votes do not count as something to share", () => {
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  const posted = stubSlack({ ok: true });

  return sendSlackNotification({ canteens: { Flow: 0, Fresh4you: 0 }, date: "2026-08-17" }).then(
    (result) => {
      assert.equal((result as any).skipped, true);
      assert.equal(posted.length, 0);
    }
  );
});

test("a real tally is posted, winner first", async () => {
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  const posted = stubSlack({ ok: true });

  const result = await sendSlackNotification({
    canteens: { Flow: 1, Fresh4you: 4 },
    dishes: { Fresh4you: "Fiskesuppe" },
    date: "2026-08-17",
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(posted.length, 1);
  const text = posted[0].body.blocks[1].text.text;
  assert.ok(text.indexOf("Fresh4you") < text.indexOf("Flow"), "most votes first");
  assert.match(text, /⭐/);
});

test("a rejected message says what Slack said, not just that it failed", async () => {
  // The difference between "fix the message" and "the alerting channel has been
  // dead for months" is entirely in this string.
  process.env.SLACK_WEBHOOK_URL = WEBHOOK;
  stubSlack({ ok: false, status: 403, text: "invalid_token" });

  const result = await sendSlackNotification({ canteens: { Flow: 2 }, date: "2026-08-17" });

  assert.match((result as any).error, /invalid_token/);
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

test("with no webhook configured, both paths skip silently", async () => {
  const posted = stubSlack({ ok: true });

  assert.deepEqual(await sendCronAlert("warning", "t", ["d"]), { skipped: true });
  assert.equal((await sendSlackNotification({ canteens: { Flow: 1 }, date: "2026-08-17" })).skipped, true);
  assert.equal(posted.length, 0);
});
