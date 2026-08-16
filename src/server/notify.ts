export interface NotifyPayload {
  canteens: Record<string, number>;
  dishes?: Record<string, string>;
  date: string;
  lang?: "no" | "en";
}

/**
 * Posts an operational alert about the weekly updater to Slack.
 *
 * The deleted GitHub workflow opened an issue when a run failed, which was the
 * only reason anyone found out before staff saw empty cards on Monday. Vercel
 * Cron has no equivalent, so failures are announced through the Slack webhook
 * the app already has. Never throws: an alert that fails must not turn a
 * partial success into a hard error.
 */
export async function sendCronAlert(
  level: "error" | "warning",
  title: string,
  details: string[]
): Promise<{ ok?: boolean; skipped?: boolean }> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { skipped: true };

  const icon = level === "error" ? "🚨" : "⚠️";
  const body = {
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${icon} ${title}` } },
      {
        type: "section",
        text: { type: "mrkdwn", text: details.map((d) => `• ${d}`).join("\n") || "_no detail_" },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `Weekly menu updater · ${new Date().toISOString()}` }],
      },
    ],
  };

  return await postToSlack(webhookUrl, body, "Cron alert").then(
    (result) => (result.ok ? { ok: true } : { skipped: true })
  );
}

/**
 * Posts a block payload and reports what Slack actually said.
 *
 * Both callers used to collapse every failure into one opaque string — "Failed
 * to send", or a swallowed `skipped: true`. A revoked webhook, a channel that
 * was archived and a payload Slack refused all looked identical, which is a bad
 * property for the only thing that tells anyone the updater died. Slack is
 * specific if you read the body: `invalid_payload` for a malformed message,
 * `invalid_token` or `no_service` for a URL that no longer works. That
 * distinction is the difference between "fix the message" and "the alerting
 * channel has been dead for months".
 */
async function postToSlack(
  webhookUrl: string,
  body: unknown,
  what: string
): Promise<{ ok: true } | { ok: false; status?: number; detail: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Slack answers a webhook failure with a short plain-text reason.
      const detail = await res.text().catch(() => "");
      console.error(`${what} rejected by Slack: ${res.status} ${detail}`);
      return { ok: false, status: res.status, detail: detail || `HTTP ${res.status}` };
    }

    return { ok: true };
  } catch (err: any) {
    console.error(`${what} could not reach Slack:`, err);
    return { ok: false, detail: err?.message ?? "network error" };
  }
}

export async function sendSlackNotification(data: NotifyPayload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return { skipped: true };
  }

  const { canteens, dishes = {}, date, lang = "no" } = data;

  const sorted = Object.entries(canteens)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  // An empty tally builds a section block with empty text, which Slack rejects
  // outright — so sharing before anyone had voted came back "Failed to send"
  // and looked like a broken webhook. It was reachable every time; the message
  // was unsendable. Worth guarding rather than fixing at the call site: until
  // today the vote endpoint returned `{}` for every vote ever cast, so this was
  // not the edge case it looks like. It was every share.
  if (sorted.length === 0) {
    return { skipped: true, reason: "no votes to share yet" };
  }
  const maxVotes = Math.max(0, ...Object.values(canteens));
  const totalVotes = Object.values(canteens).reduce((a, b) => a + b, 0);

  const d = new Date(date);
  const formattedDate = d.toLocaleDateString(
    lang === "no" ? "nb-NO" : "en-GB",
    { weekday: "long", day: "numeric", month: "long" }
  );

  const lines = sorted.map(([name, count]) => {
    const isWinner = count === maxVotes && count > 0;
    const dish = dishes[name] ? ` — ${dishes[name]}` : "";
    const filled = totalVotes > 0 ? Math.round((count / totalVotes) * 8) : 0;
    const bar = "█".repeat(filled) + "░".repeat(8 - filled);
    const votesLabel = lang === "no" ? "stemmer" : "votes";
    return `${isWinner ? "⭐ " : "     "}*${name}*${dish}\n${bar} ${count} ${votesLabel}`;
  });

  const headerText =
    lang === "no"
      ? `🍽️ Lunsjresultater — ${formattedDate}`
      : `🍽️ Lunch results — ${formattedDate}`;

  const body = {
    blocks: [
      { type: "header", text: { type: "plain_text", text: headerText } },
      { type: "section", text: { type: "mrkdwn", text: lines.join("\n\n") } },
    ],
  };

  const result = await postToSlack(webhookUrl, body, "Lunch result");
  if (result.ok) return { ok: true };
  return { error: `Slack rejected the message: ${result.detail}` };
}
