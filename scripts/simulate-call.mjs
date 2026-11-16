#!/usr/bin/env node
/**
 * Feeds a pretend conversation into a call, so the live call screen can be
 * tried without Recall.ai (no bot, no cost). Question suggestions are real:
 * they use the Anthropic API.
 *
 * 1. Put MEETING_BOT_PROVIDER="fake" in .env and restart the app.
 * 2. Start a call on a solution's Calls tab (any Zoom/Meet/Teams-looking link).
 * 3. Run:  node scripts/simulate-call.mjs "<URL of the call page>" [transcript.txt]
 *
 * A transcript file has one "Speaker: text" line per utterance.
 */
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const SAMPLE = `Dana (CTO): Thanks for making time. The short version is that our order system is twenty years old and it is holding us back.
You: Understood. What does it run on today?
Dana (CTO): An AS/400. Orders come in from the web shop as nightly batch files over SFTP, so finance sees them a day late.
Sam (Finance): And month-end close takes us nine days because we reconcile those files by hand.
You: That is a long close.
Dana (CTO): We tried to fix it two years ago with an event streaming project, but it stalled after the lead engineer left.
Sam (Finance): The board has approved budget for this year, but they want a fixed price and they want it live before the summer peak.
Dana (CTO): The other constraint is that the warehouse scanners talk directly to the AS/400, and nobody is sure how.
You: Good to know.
Sam (Finance): Honestly my worry is that we replace the system and close still takes nine days.`;

const [pageUrl, file] = process.argv.slice(2);
const match = pageUrl?.match(
  /^(https?:\/\/[^/]+)\/customers\/([0-9a-f-]{36})\/.*\/calls\/([0-9a-f-]{36})/,
);
const secret = process.env.RECALL_WEBHOOK_SECRET;
if (!match || !secret?.startsWith("whsec_")) {
  console.error(
    'Usage: node scripts/simulate-call.mjs "<URL of the call page>" [transcript.txt]\n(RECALL_WEBHOOK_SECRET must be set in .env)',
  );
  process.exit(1);
}
const [, origin, customerId, callId] = match;
const key = Buffer.from(secret.slice("whsec_".length), "base64");
const lines = (file ? readFileSync(file, "utf8") : SAMPLE)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

for (const line of lines) {
  const colon = line.indexOf(":");
  const speaker = colon === -1 ? "Speaker" : line.slice(0, colon).trim();
  const text = colon === -1 ? line : line.slice(colon + 1).trim();
  const body = JSON.stringify({
    event: "transcript.data",
    data: {
      data: {
        words: [{ text, start_timestamp: null, end_timestamp: null }],
        participant: { id: 1, name: speaker },
      },
      bot: {
        id: `fake-${callId}`,
        metadata: { customer_id: customerId, call_id: callId },
      },
    },
  });
  const id = `msg_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const response = await fetch(`${origin}/api/webhooks/recall`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`,
    },
    body,
  });
  console.log(`${response.status}  ${speaker}: ${text.slice(0, 60)}`);
  if (!response.ok) process.exit(1);
  await new Promise((resolve) =>
    setTimeout(resolve, Number(process.env.SIMULATE_DELAY_MS ?? 2500)),
  );
}
console.log("Done. End the call in the app to index the transcript.");
