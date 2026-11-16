import { createHmac, timingSafeEqual } from "node:crypto";

/** Reject deliveries whose timestamp is further than this from now (replay guard). */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies that a request really comes from Recall.ai: an HMAC-SHA256 over
 * `<id>.<timestamp>.<raw body>` with the workspace secret (`whsec_…`),
 * as documented by Recall.ai.
 */
export function verifyRecallSignature(input: {
  secret: string | undefined;
  headers: Headers;
  rawBody: string;
  now?: Date;
}): boolean {
  const { secret, headers, rawBody } = input;
  const id = headers.get("webhook-id") ?? headers.get("svix-id");
  const timestamp =
    headers.get("webhook-timestamp") ?? headers.get("svix-timestamp");
  const signatures =
    headers.get("webhook-signature") ?? headers.get("svix-signature");
  if (!secret?.startsWith("whsec_") || !id || !timestamp || !signatures) {
    return false;
  }

  const sentAt = Number(timestamp);
  const nowSeconds = (input.now ?? new Date()).getTime() / 1000;
  if (
    !Number.isFinite(sentAt) ||
    Math.abs(nowSeconds - sentAt) > TOLERANCE_SECONDS
  ) {
    return false;
  }

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest();
  // Several signatures can be present while a secret is being rotated.
  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const given = Buffer.from(signature, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** Signs a payload the way Recall.ai does. For tests and the call simulator. */
export function signRecallPayload(input: {
  secret: string;
  id: string;
  timestamp: number;
  rawBody: string;
}): string {
  const key = Buffer.from(input.secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.rawBody}`)
    .digest("base64");
  return `v1,${signature}`;
}

/** The parts of a Recall.ai webhook Robin uses. */
export type RecallEvent =
  | {
      type: "transcript";
      botId: string;
      metadata: Record<string, string>;
      speaker: string;
      text: string;
      /** Seconds from the start of the recording, when the provider reports them. */
      startSeconds: number | null;
      endSeconds: number | null;
    }
  | {
      type: "status";
      botId: string;
      metadata: Record<string, string>;
      code: string;
      subCode: string | null;
    };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function stringMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Parses a verified webhook body. Returns null for events Robin ignores. */
export function parseRecallEvent(body: unknown): RecallEvent | null {
  const root = record(body);
  const event = typeof root.event === "string" ? root.event : "";
  const data = record(root.data);
  const bot = record(data.bot);
  const inner = record(data.data);
  if (typeof bot.id !== "string") return null;
  const metadata = stringMap(bot.metadata);

  if (event === "transcript.data") {
    const words = Array.isArray(inner.words) ? inner.words.map(record) : [];
    const text = words
      .map((word) => (typeof word.text === "string" ? word.text : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return null;
    const seconds = (value: unknown): number | null => {
      const relative = record(value).relative;
      return typeof relative === "number" ? relative : null;
    };
    const participant = record(inner.participant);
    return {
      type: "transcript",
      botId: bot.id,
      metadata,
      speaker:
        typeof participant.name === "string" && participant.name.trim()
          ? participant.name.trim()
          : "Unknown speaker",
      text,
      startSeconds: seconds(words[0]?.start_timestamp),
      endSeconds: seconds(words.at(-1)?.end_timestamp),
    };
  }

  if (event.startsWith("bot.") && typeof inner.code === "string") {
    return {
      type: "status",
      botId: bot.id,
      metadata,
      code: inner.code,
      subCode: typeof inner.sub_code === "string" ? inner.sub_code : null,
    };
  }
  return null;
}
