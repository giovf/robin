import { handleRecallEvent } from "@/lib/calls/calls";
import {
  parseRecallEvent,
  verifyRecallSignature,
} from "@/lib/calls/recall-webhook";

/**
 * Receives real-time transcript and bot status events from Recall.ai. There
 * is no signed-in user here: the request is trusted only if its signature
 * verifies, and an event is stored only if its bot belongs to the customer it
 * names.
 */
export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const verified = verifyRecallSignature({
    secret: process.env.RECALL_WEBHOOK_SECRET,
    headers: request.headers,
    rawBody,
  });
  if (!verified) return new Response("Invalid signature.", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON.", { status: 400 });
  }
  const event = parseRecallEvent(body);
  const deliveryId =
    request.headers.get("webhook-id") ?? request.headers.get("svix-id") ?? "";
  if (event) await handleRecallEvent(event, deliveryId);
  // Always acknowledge a verified delivery, or the provider retries for a day.
  return new Response(null, { status: 200 });
}
