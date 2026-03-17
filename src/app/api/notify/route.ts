import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return NextResponse.json({ skipped: true });
  }

  let canteens: Record<string, number>;
  let dishes: Record<string, string>;
  let date: string;
  let lang: "no" | "en";

  try {
    const body = await request.json();
    if (!body || typeof body.canteens !== 'object' || !body.date) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    canteens = body.canteens;
    dishes = body.dishes || {};
    date = body.date;
    lang = body.lang === 'no' ? 'no' : 'en';
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

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

  const headerText = lang === "no"
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
    if (!res.ok) throw new Error(`Slack returned ${res.status}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Slack webhook error:", err);
    return NextResponse.json({ error: "Failed to send" }, { status: 500 });
  }
}
