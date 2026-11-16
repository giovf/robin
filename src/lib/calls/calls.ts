import { and, asc, desc, eq, gt, sql } from "drizzle-orm";

import { requireEnv } from "@/db/env";
import { isUuid } from "@/db/customer/database-url";
import {
  calls,
  chunks,
  suggestions,
  SUGGESTION_STATES,
  transcriptSegments,
  type CallBotStatus,
  type CallRecord,
  type Suggestion,
  type SuggestionState,
  type TranscriptSegment,
} from "@/db/customer/schema";

import { getCustomerAgent } from "../agent/customer-agent";
import { LlmError } from "../agent/llm";
import { chunkText } from "../chunking";
import {
  getCustomerConnection,
  getCustomerConnectionForBot,
  type CustomerDb,
} from "../customer-connection";
import { embedTexts, getEmbeddingProvider } from "../embeddings";
import { getSolution } from "../solutions";
import { optionalText, requiredText, ValidationError } from "../validation";
import { getMeetingBot, mapRecallStatus, MeetingBotError } from "./meeting-bot";
import type { RecallEvent } from "./recall-webhook";

export const BOT_NAME = "Robin (notetaker)";
export const CALL_TITLE_MAX_LENGTH = 160;

const MEETING_HOSTS = [
  /(^|\.)zoom\.us$/,
  /^meet\.google\.com$/,
  /^teams\.microsoft\.com$/,
  /^teams\.live\.com$/,
];

/** @throws ValidationError unless this is a Zoom, Google Meet or Teams link. */
export function parseMeetingUrl(value: unknown): string {
  const text = requiredText(value, "Meeting link", 2000);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ValidationError(
      "Enter the full meeting link, starting with https://.",
    );
  }
  if (
    url.protocol !== "https:" ||
    !MEETING_HOSTS.some((host) => host.test(url.hostname.toLowerCase()))
  ) {
    throw new ValidationError(
      "Enter a Zoom, Google Meet or Microsoft Teams meeting link.",
    );
  }
  return url.toString();
}

const ACTIVE: CallRecord["botStatus"][] = [
  "creating",
  "joining",
  "in_call",
  "leaving",
];

export function isCallActive(call: Pick<CallRecord, "botStatus">): boolean {
  return ACTIVE.includes(call.botStatus);
}

export interface StartCallInput {
  solutionId: string;
  meetingUrl: unknown;
  title?: unknown;
  /** The user ticked the recording-consent acknowledgement. */
  consentAcknowledged: boolean;
}

/**
 * Starts a call session: records the consent acknowledgement, then sends the
 * (visible, named) bot to the meeting. This is the ONLY place a bot is sent.
 *
 * @throws ValidationError (bad link, no consent, unknown solution, bot failed
 * to start), CustomerConnectionError
 */
export async function startCall(
  userId: string,
  customerId: string,
  input: StartCallInput,
): Promise<CallRecord> {
  const meetingUrl = parseMeetingUrl(input.meetingUrl);
  const title = optionalText(input.title, "Title", CALL_TITLE_MAX_LENGTH);
  if (input.consentAcknowledged !== true) {
    throw new ValidationError(
      "Confirm that the participants have agreed to the recording before Robin joins.",
    );
  }
  const solution = await getSolution(userId, customerId, input.solutionId);
  if (!solution) throw new ValidationError("This solution does not exist.");

  const db = await getCustomerConnection(userId, customerId);
  const [call] = await db
    .insert(calls)
    .values({
      solutionId: solution.id,
      title,
      meetingUrl,
      botStatus: "creating",
      consentAcknowledged: true,
      consentAcknowledgedAt: new Date(),
    })
    .returning();

  try {
    const { botId } = await getMeetingBot().createBot({
      meetingUrl,
      botName: BOT_NAME,
      webhookUrl: new URL(
        "/api/webhooks/recall",
        // The provider must reach this over the internet; in development
        // that is a tunnel address, while APP_URL stays on localhost.
        process.env.WEBHOOK_BASE_URL || requireEnv("APP_URL"),
      ).toString(),
      metadata: { customer_id: customerId, call_id: call.id },
    });
    const [started] = await db
      .update(calls)
      .set({ botId, botStatus: "joining" })
      .where(eq(calls.id, call.id))
      .returning();
    return started;
  } catch (error) {
    await db
      .update(calls)
      .set({
        botStatus: "error",
        botStatusDetail:
          error instanceof MeetingBotError
            ? `bot_create_failed_${error.status ?? "network"}`
            : "bot_create_failed",
        endedAt: new Date(),
      })
      .where(eq(calls.id, call.id));
    if (error instanceof MeetingBotError) {
      throw new ValidationError(
        "The meeting bot could not be started. Check the meeting link and the Recall.ai account, then try again.",
      );
    }
    throw error;
  }
}

export async function listCalls(
  userId: string,
  customerId: string,
  solutionId: string,
): Promise<CallRecord[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(solutionId)) return [];
  return db
    .select()
    .from(calls)
    .where(eq(calls.solutionId, solutionId))
    .orderBy(desc(calls.createdAt));
}

export async function getCall(
  userId: string,
  customerId: string,
  callId: string,
): Promise<CallRecord | null> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(callId)) return null;
  const [call] = await db
    .select()
    .from(calls)
    .where(eq(calls.id, callId))
    .limit(1);
  return call ?? null;
}

/** Renders stored segments as "Speaker: text" lines. */
export function transcriptText(
  segments: Pick<TranscriptSegment, "speaker" | "text">[],
): string {
  const lines: string[] = [];
  let lastSpeaker: string | null = null;
  for (const segment of segments) {
    if (segment.speaker === lastSpeaker) {
      lines[lines.length - 1] += ` ${segment.text}`;
    } else {
      lines.push(`${segment.speaker}: ${segment.text}`);
      lastSpeaker = segment.speaker;
    }
  }
  return lines.join("\n");
}

async function segmentsOf(
  db: CustomerDb,
  callId: string,
): Promise<TranscriptSegment[]> {
  return (
    db
      .select()
      .from(transcriptSegments)
      .where(eq(transcriptSegments.callId, callId))
      // Arrival order: provider timestamps are missing for caption-based
      // transcripts, so they cannot be relied on for ordering.
      .orderBy(asc(transcriptSegments.createdAt))
  );
}

/**
 * Adds a finished call's transcript to the customer's searchable context
 * (chunks that reference the call). Safe to run again.
 */
async function indexTranscript(db: CustomerDb, callId: string): Promise<void> {
  const text = transcriptText(await segmentsOf(db, callId));
  const pieces = chunkText(text);
  const vectors = await embedTexts(pieces);
  const model = getEmbeddingProvider().id;
  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.callId, callId));
    if (pieces.length) {
      await tx.insert(chunks).values(
        pieces.map((piece, chunkIndex) => ({
          callId,
          chunkIndex,
          text: piece,
          embedding: vectors[chunkIndex],
          embeddingModel: model,
        })),
      );
    }
    await tx
      .update(calls)
      .set({ transcriptIndexedAt: new Date() })
      .where(eq(calls.id, callId));
  });
}

/** Applies a bot status to a call; a call that has ended gets its transcript indexed. */
async function applyStatus(
  db: CustomerDb,
  call: CallRecord,
  status: CallBotStatus | null,
  detail: string | null,
): Promise<CallRecord> {
  if (!status) return call;
  // Never move a finished call back to an earlier state (late or replayed events).
  if (!isCallActive(call) && status !== call.botStatus) return call;

  const now = new Date();
  const ended = status === "left" || status === "error" || status === "leaving";
  const [updated] = await db
    .update(calls)
    .set({
      botStatus: status,
      botStatusDetail: detail,
      startedAt: call.startedAt ?? (status === "in_call" ? now : null),
      endedAt: call.endedAt ?? (ended ? now : null),
    })
    .where(eq(calls.id, call.id))
    .returning();
  if (
    (status === "left" || status === "error") &&
    !updated.transcriptIndexedAt
  ) {
    await indexTranscript(db, call.id);
    return { ...updated, transcriptIndexedAt: new Date() };
  }
  return updated;
}

/**
 * Handles a verified Recall.ai webhook. The event names its customer and bot;
 * it is accepted only if that bot belongs to a call in that customer's
 * database. Returns false for events that match nothing (they are dropped).
 */
export async function handleRecallEvent(
  event: RecallEvent,
  deliveryId: string,
): Promise<boolean> {
  let db: CustomerDb;
  let callId: string;
  try {
    ({ db, callId } = await getCustomerConnectionForBot(
      event.metadata.customer_id ?? "",
      event.botId,
    ));
  } catch {
    return false;
  }
  const [call] = await db.select().from(calls).where(eq(calls.id, callId));

  if (event.type === "status") {
    await applyStatus(db, call, mapRecallStatus(event.code), event.subCode);
    return true;
  }

  const now = new Date();
  const startedAt = call.startedAt ?? now;
  // Captions carry no timestamps: fall back to time since the call started.
  const elapsedMs = Math.max(now.getTime() - startedAt.getTime(), 0);
  const startMs =
    event.startSeconds !== null
      ? Math.round(event.startSeconds * 1000)
      : elapsedMs;
  await db
    .insert(transcriptSegments)
    .values({
      callId,
      speaker: event.speaker.slice(0, 200),
      text: event.text,
      startMs,
      endMs:
        event.endSeconds !== null
          ? Math.round(event.endSeconds * 1000)
          : startMs,
      deliveryId,
    })
    .onConflictDoNothing({ target: transcriptSegments.deliveryId });
  if (
    !call.startedAt ||
    call.botStatus === "joining" ||
    call.botStatus === "creating"
  ) {
    // Speech proves the bot is in the call, even if no status event arrived.
    await db
      .update(calls)
      .set({
        startedAt,
        botStatus: isCallActive(call) ? "in_call" : call.botStatus,
      })
      .where(eq(calls.id, callId));
  }
  return true;
}

/** Asks the provider for the bot's current state and applies it. */
export async function refreshCallStatus(
  userId: string,
  customerId: string,
  callId: string,
): Promise<CallRecord | null> {
  const call = await getCall(userId, customerId, callId);
  if (!call || !call.botId || !isCallActive(call)) return call;
  const db = await getCustomerConnection(userId, customerId);
  try {
    const state = await getMeetingBot().getBot(call.botId);
    return await applyStatus(db, call, state.status, state.detail);
  } catch (error) {
    if (error instanceof MeetingBotError) return call;
    throw error;
  }
}

/** Removes the bot from the meeting and closes the call. */
export async function endCall(
  userId: string,
  customerId: string,
  callId: string,
): Promise<CallRecord | null> {
  const call = await getCall(userId, customerId, callId);
  if (!call || !isCallActive(call)) return call;
  const db = await getCustomerConnection(userId, customerId);
  if (call.botId) {
    try {
      await getMeetingBot().leaveCall(call.botId);
    } catch (error) {
      // The bot may already be gone; closing our side is still right.
      if (!(error instanceof MeetingBotError)) throw error;
    }
  }
  return applyStatus(db, call, "left", "ended_by_user");
}

// ── Live view ──────────────────────────────────────────────────────────────

export interface LiveCallState {
  call: Pick<
    CallRecord,
    "id" | "title" | "botStatus" | "botStatusDetail" | "startedAt" | "endedAt"
  >;
  active: boolean;
  /** Segments after the `after` cursor, in order. */
  segments: Pick<TranscriptSegment, "id" | "speaker" | "text" | "startMs">[];
  /** Pass back as `after` on the next poll. */
  cursor: string;
  suggestions: Pick<Suggestion, "id" | "text" | "rationale" | "state">[];
}

/** What the live call screen needs; `after` is the cursor from the last poll. */
export async function getLiveCallState(
  userId: string,
  customerId: string,
  callId: string,
  after?: string,
): Promise<LiveCallState | null> {
  const call = await getCall(userId, customerId, callId);
  if (!call) return null;
  const db = await getCustomerConnection(userId, customerId);
  const since =
    after && !Number.isNaN(Date.parse(after)) ? new Date(after) : null;
  const rows = await db
    .select({
      id: transcriptSegments.id,
      speaker: transcriptSegments.speaker,
      text: transcriptSegments.text,
      startMs: transcriptSegments.startMs,
      // Microsecond precision as text: a JS Date would round and repeat rows.
      createdAt: sql<string>`to_char(${transcriptSegments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.callId, callId),
        since
          ? sql`${transcriptSegments.createdAt} > ${after}::timestamptz`
          : undefined,
      ),
    )
    .orderBy(asc(transcriptSegments.createdAt));
  const all = await db
    .select({
      id: suggestions.id,
      text: suggestions.text,
      rationale: suggestions.rationale,
      state: suggestions.state,
    })
    .from(suggestions)
    .where(eq(suggestions.callId, callId))
    .orderBy(desc(suggestions.createdAt));
  return {
    call: {
      id: call.id,
      title: call.title,
      botStatus: call.botStatus,
      botStatusDetail: call.botStatusDetail,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
    },
    active: isCallActive(call),
    segments: rows.map(({ createdAt: _createdAt, ...segment }) => segment),
    cursor: rows.at(-1)?.createdAt ?? after ?? "",
    suggestions: all,
  };
}

/** The whole stored transcript of a call. */
export async function getCallTranscript(
  userId: string,
  customerId: string,
  callId: string,
): Promise<TranscriptSegment[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(callId)) return [];
  return segmentsOf(db, callId);
}

// ── Suggestions ────────────────────────────────────────────────────────────

/** New speech needed before asking the model again. */
const MIN_NEW_TRANSCRIPT_CHARS = 200;
/** Minimum time between model calls for one call session (cost and noise guard). */
const MIN_SECONDS_BETWEEN_RUNS = 20;

const globalForRuns = globalThis as typeof globalThis & {
  __robinSuggestionRuns?: Map<string, { at: number; running: boolean }>;
};
function runs(): Map<string, { at: number; running: boolean }> {
  globalForRuns.__robinSuggestionRuns ??= new Map();
  return globalForRuns.__robinSuggestionRuns;
}

export type SuggestionRun =
  | { ran: true; added: number }
  | {
      ran: false;
      reason: "inactive" | "too_soon" | "busy" | "not_enough_new" | "failed";
    };

/**
 * Generates question suggestions for a live call if enough has been said
 * since the last run. Called while someone has the live screen open, so the
 * model is never called for a call nobody is watching.
 */
export async function maybeGenerateSuggestions(
  userId: string,
  customerId: string,
  callId: string,
  options: { force?: boolean; now?: Date } = {},
): Promise<SuggestionRun> {
  const call = await getCall(userId, customerId, callId);
  if (!call || !isCallActive(call)) return { ran: false, reason: "inactive" };

  const now = (options.now ?? new Date()).getTime();
  const state = runs().get(callId) ?? { at: 0, running: false };
  if (state.running) return { ran: false, reason: "busy" };
  if (!options.force && now - state.at < MIN_SECONDS_BETWEEN_RUNS * 1000) {
    return { ran: false, reason: "too_soon" };
  }

  const db = await getCustomerConnection(userId, customerId);
  const existing = await db
    .select({ text: suggestions.text, createdAt: suggestions.createdAt })
    .from(suggestions)
    .where(eq(suggestions.callId, callId))
    .orderBy(desc(suggestions.createdAt));
  const [fresh] = await db
    .select({
      chars:
        sql<number>`coalesce(sum(length(${transcriptSegments.text})), 0)`.mapWith(
          Number,
        ),
    })
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.callId, callId),
        existing[0]
          ? gt(transcriptSegments.createdAt, existing[0].createdAt)
          : undefined,
      ),
    );
  if (!options.force && fresh.chars < MIN_NEW_TRANSCRIPT_CHARS) {
    return { ran: false, reason: "not_enough_new" };
  }

  runs().set(callId, { at: now, running: true });
  try {
    const agent = await getCustomerAgent(userId, customerId);
    const questions = await agent.suggestQuestions({
      solutionId: call.solutionId,
      transcript: transcriptText(await segmentsOf(db, callId)),
      alreadySuggested: existing.map((suggestion) => suggestion.text),
    });
    const seen = new Set(existing.map((s) => s.text.toLowerCase()));
    const added = questions.filter((q) => !seen.has(q.question.toLowerCase()));
    if (added.length) {
      await db.insert(suggestions).values(
        added.map((q) => ({
          callId,
          text: q.question,
          rationale: q.rationale,
        })),
      );
    }
    return { ran: true, added: added.length };
  } catch (error) {
    if (error instanceof LlmError) {
      console.error(`Suggestions for call ${callId} failed: ${error.reason}`);
      return { ran: false, reason: "failed" };
    }
    throw error;
  } finally {
    runs().set(callId, { at: now, running: false });
  }
}

/** Marks a suggestion asked, dismissed, or shown again. Returns false if it is not this call's. */
export async function setSuggestionState(
  userId: string,
  customerId: string,
  callId: string,
  suggestionId: string,
  state: unknown,
): Promise<boolean> {
  if (!SUGGESTION_STATES.includes(state as SuggestionState)) {
    throw new ValidationError("Unknown suggestion state.");
  }
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(callId) || !isUuid(suggestionId)) return false;
  const updated = await db
    .update(suggestions)
    .set({ state: state as SuggestionState })
    .where(
      and(eq(suggestions.id, suggestionId), eq(suggestions.callId, callId)),
    )
    .returning({ id: suggestions.id });
  return updated.length > 0;
}
