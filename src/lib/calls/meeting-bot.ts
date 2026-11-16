import { requireEnv } from "@/db/env";
import type { CallBotStatus } from "@/db/customer/schema";

/*
 * The meeting bot (a visible participant that transcribes the call) behind an
 * interface, so it can be faked in tests and swapped. Sending a real bot
 * costs money and puts a recorder in someone's meeting: only ever do it on
 * the user's explicit action, after the consent acknowledgement.
 */

export interface BotState {
  status: CallBotStatus;
  /** Provider's reason code when the bot failed or was removed. */
  detail: string | null;
}

export interface CreateBotInput {
  meetingUrl: string;
  /** Shown to everyone in the meeting. */
  botName: string;
  /** Where the provider delivers real-time transcript events. */
  webhookUrl: string;
  /**
   * Echoed back on every webhook, to route it to the right customer. Sent to
   * the provider: ids only, never names or content.
   */
  metadata: Record<string, string>;
}

export interface MeetingBotProvider {
  createBot(input: CreateBotInput): Promise<{ botId: string }>;
  getBot(botId: string): Promise<BotState>;
  /** Removes the bot from the meeting. Irreversible. */
  leaveCall(botId: string): Promise<void>;
}

export class MeetingBotError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MeetingBotError";
  }
}

/** Maps a Recall.ai bot status code to ours. Unknown codes keep the current status. */
export function mapRecallStatus(code: string): CallBotStatus | null {
  switch (code.replace(/^bot\./, "")) {
    case "joining_call":
    case "in_waiting_room":
      return "joining";
    case "in_call_not_recording":
    case "in_call_recording":
    case "recording_permission_allowed":
    case "recording_permission_denied":
      return "in_call";
    case "call_ended":
      return "leaving";
    case "done":
      return "left";
    case "fatal":
      return "error";
    default:
      return null;
  }
}

export const TRANSCRIPT_PROVIDERS = [
  "meeting_captions",
  "recallai_streaming",
] as const;
export type TranscriptProvider = (typeof TRANSCRIPT_PROVIDERS)[number];

export interface RecallConfig {
  apiKey: string;
  region: string;
  transcriptProvider: TranscriptProvider;
}

/** Recall.ai over REST. */
export class RecallMeetingBot implements MeetingBotProvider {
  constructor(
    private readonly config: RecallConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchImpl(
      `https://${this.config.region}.recall.ai/api/v1${path}`,
      {
        ...init,
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      },
    );
    if (!response.ok) {
      throw new MeetingBotError(
        `Recall.ai request failed (${response.status}) for ${path.split("/")[1]}.`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async createBot(input: CreateBotInput): Promise<{ botId: string }> {
    const provider =
      this.config.transcriptProvider === "recallai_streaming"
        ? { recallai_streaming: { mode: "prioritize_low_latency" } }
        : { meeting_captions: {} };
    const bot = await this.request<{ id: string }>("/bot/", {
      method: "POST",
      body: JSON.stringify({
        meeting_url: input.meetingUrl,
        bot_name: input.botName,
        metadata: input.metadata,
        recording_config: {
          transcript: { provider },
          realtime_endpoints: [
            {
              type: "webhook",
              url: input.webhookUrl,
              events: ["transcript.data"],
            },
          ],
        },
      }),
    });
    return { botId: bot.id };
  }

  async getBot(botId: string): Promise<BotState> {
    const bot = await this.request<{
      status_changes?: { code: string; sub_code: string | null }[];
    }>(`/bot/${encodeURIComponent(botId)}/`);
    const changes = bot.status_changes ?? [];
    let status: CallBotStatus = "joining";
    let detail: string | null = null;
    for (const change of changes) {
      const mapped = mapRecallStatus(change.code);
      if (mapped) {
        status = mapped;
        detail = change.sub_code;
      }
    }
    return { status, detail };
  }

  async leaveCall(botId: string): Promise<void> {
    await this.request(`/bot/${encodeURIComponent(botId)}/leave_call/`, {
      method: "POST",
    });
  }
}

/**
 * A stand-in that joins nothing and costs nothing. Bots "join" immediately;
 * transcript events are fed by tests or scripts/simulate-call.mjs.
 */
export class FakeMeetingBot implements MeetingBotProvider {
  readonly created: CreateBotInput[] = [];
  readonly states = new Map<string, BotState>();
  failNextCreate = false;

  async createBot(input: CreateBotInput): Promise<{ botId: string }> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new MeetingBotError("Fake failure.", 500);
    }
    this.created.push(input);
    // Derived from the call, so the simulator can address it.
    const botId = `fake-${input.metadata.call_id ?? crypto.randomUUID()}`;
    this.states.set(botId, { status: "in_call", detail: null });
    return { botId };
  }

  async getBot(botId: string): Promise<BotState> {
    // Unknown ids (e.g. after a restart) are reported as still in the call.
    return this.states.get(botId) ?? { status: "in_call", detail: null };
  }

  async leaveCall(botId: string): Promise<void> {
    this.states.set(botId, { status: "left", detail: null });
  }
}

const globalForBot = globalThis as typeof globalThis & {
  __robinMeetingBot?: MeetingBotProvider;
};

/** The configured meeting-bot provider. */
export function getMeetingBot(): MeetingBotProvider {
  if (!globalForBot.__robinMeetingBot) {
    if (process.env.MEETING_BOT_PROVIDER === "fake") {
      globalForBot.__robinMeetingBot = new FakeMeetingBot();
    } else {
      const configured = process.env.RECALL_TRANSCRIPT_PROVIDER;
      globalForBot.__robinMeetingBot = new RecallMeetingBot({
        apiKey: requireEnv("RECALL_API_KEY"),
        region: process.env.RECALL_REGION || "us-west-2",
        transcriptProvider: TRANSCRIPT_PROVIDERS.includes(
          configured as TranscriptProvider,
        )
          ? (configured as TranscriptProvider)
          : "meeting_captions",
      });
    }
  }
  return globalForBot.__robinMeetingBot;
}

/** Replaces the provider (tests). */
export function setMeetingBot(next: MeetingBotProvider | undefined): void {
  globalForBot.__robinMeetingBot = next;
}
