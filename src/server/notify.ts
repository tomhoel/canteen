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

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Slack returned ${res.status}`);
    return { ok: true };
  } catch (err) {
    console.error("Cron alert failed to send:", err);
    return { skipped: true };
  }
}

export async function sendSlackNotification(data: NotifyPayload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return { skipped: true };
  }

  const { canteens, dishes = {}, date, lang = "no" } = data;

  const sorted = Object.entries(canteens).sort(([, a], [, b]) => b - a);
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

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Slack returned ${res.status}`);
    }

    return { ok: true };
  } catch (err) {
    console.error("Slack webhook error:", err);
    return { error: "Failed to send" };
  }
}
