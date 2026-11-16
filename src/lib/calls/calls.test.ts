import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { POST as recallWebhook } from "@/app/api/webhooks/recall/route";
import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { chunks } from "@/db/customer/schema";
import { createTenant, type Tenant } from "@/test/fixtures";

import { FakeLlmClient } from "../agent/fake-llm";
import { LlmError, setLlmClient } from "../agent/llm";
import {
  CustomerAccessDeniedError,
  getCustomerConnection,
} from "../customer-connection";
import { retrieveContext } from "../retrieval";
import { createSolution } from "../solutions";
import { ValidationError } from "../validation";
import {
  BOT_NAME,
  endCall,
  getCall,
  getCallTranscript,
  getLiveCallState,
  handleRecallEvent,
  listCalls,
  maybeGenerateSuggestions,
  parseMeetingUrl,
  refreshCallStatus,
  setSuggestionState,
  startCall,
} from "./calls";
import {
  FakeMeetingBot,
  mapRecallStatus,
  RecallMeetingBot,
  setMeetingBot,
} from "./meeting-bot";
import {
  parseRecallEvent,
  signRecallPayload,
  verifyRecallSignature,
  type RecallEvent,
} from "./recall-webhook";

const SECRET = `whsec_${Buffer.from("test-signing-key-0123456789").toString("base64")}`;
const MEET = "https://meet.google.com/abc-defg-hij";

let a: Tenant;
let b: Tenant;
let solutionA: string;
let solutionB: string;
let bot: FakeMeetingBot;
let llm: FakeLlmClient;
let delivery = 0;

function said(
  botId: string,
  customerId: string,
  speaker: string,
  text: string,
  startSeconds: number | null = null,
): RecallEvent {
  return {
    type: "transcript",
    botId,
    metadata: { customer_id: customerId },
    speaker,
    text,
    startSeconds,
    endSeconds: startSeconds === null ? null : startSeconds + 2,
  };
}
const nextId = (): string => `msg_${++delivery}_${crypto.randomUUID()}`;

async function begin(tenant: Tenant, solutionId: string) {
  return startCall(tenant.user.id, tenant.customer.id, {
    solutionId,
    meetingUrl: MEET,
    title: "Discovery call",
    consentAcknowledged: true,
  });
}

beforeAll(async () => {
  vi.stubEnv("RECALL_WEBHOOK_SECRET", SECRET);
  a = await createTenant("call-a");
  b = await createTenant("call-b");
  solutionA = (
    await createSolution(a.user.id, a.customer.id, { name: "Alpha platform" })
  ).id;
  solutionB = (
    await createSolution(b.user.id, b.customer.id, { name: "Beta platform" })
  ).id;
});

beforeEach(() => {
  bot = new FakeMeetingBot();
  setMeetingBot(bot);
  llm = new FakeLlmClient();
  setLlmClient(llm);
});

afterAll(async () => {
  setMeetingBot(undefined);
  setLlmClient(undefined);
  vi.unstubAllEnvs();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("parseMeetingUrl", () => {
  it("accepts Zoom, Meet and Teams links only", () => {
    for (const url of [
      MEET,
      "https://acme.zoom.us/j/123456789?pwd=abc",
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting",
      "https://teams.live.com/meet/9312345",
    ]) {
      expect(parseMeetingUrl(url)).toBe(url);
    }
    for (const url of [
      "",
      "not a url",
      "http://meet.google.com/abc-defg-hij",
      "https://evil.example/meet.google.com",
      "https://zoom.us.evil.example/j/1",
      "https://notzoom.us/j/1",
      "javascript:alert(1)",
    ]) {
      expect(() => parseMeetingUrl(url), url).toThrow(ValidationError);
    }
  });
});

describe("startCall", () => {
  it("refuses to send a bot without the consent acknowledgement", async () => {
    await expect(
      startCall(a.user.id, a.customer.id, {
        solutionId: solutionA,
        meetingUrl: MEET,
        consentAcknowledged: false,
      }),
    ).rejects.toThrow(/agreed to the recording/);
    expect(bot.created).toHaveLength(0);
    expect(await listCalls(a.user.id, a.customer.id, solutionA)).toEqual([]);
  });

  it("stores the acknowledgement and sends a named bot with ids only", async () => {
    const call = await begin(a, solutionA);
    expect(call).toMatchObject({
      botStatus: "joining",
      consentAcknowledged: true,
      title: "Discovery call",
    });
    expect(call.consentAcknowledgedAt).toBeInstanceOf(Date);
    expect(call.botId).toMatch(/^fake-/);
    expect(bot.created).toEqual([
      {
        meetingUrl: MEET,
        botName: BOT_NAME,
        webhookUrl: "http://localhost:3000/api/webhooks/recall",
        metadata: { customer_id: a.customer.id, call_id: call.id },
      },
    ]);
  });

  it("validates the link and the solution, and records a failed start", async () => {
    await expect(
      startCall(a.user.id, a.customer.id, {
        solutionId: solutionA,
        meetingUrl: "https://example.com/room",
        consentAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Another customer's solution id is unknown here.
    await expect(begin(a, solutionB)).rejects.toThrow(/does not exist/);
    await expect(begin(a, "nope")).rejects.toBeInstanceOf(ValidationError);
    expect(bot.created).toHaveLength(0);

    bot.failNextCreate = true;
    await expect(begin(a, solutionA)).rejects.toThrow(/could not be started/);
    const [failed] = await listCalls(a.user.id, a.customer.id, solutionA);
    expect(failed).toMatchObject({
      botStatus: "error",
      botStatusDetail: "bot_create_failed_500",
      botId: null,
    });
  });

  it("cannot be started for another organisation's customer", async () => {
    await expect(
      startCall(a.user.id, b.customer.id, {
        solutionId: solutionB,
        meetingUrl: MEET,
        consentAcknowledged: true,
      }),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    expect(bot.created).toHaveLength(0);
  });
});

describe("a call from start to finish", () => {
  it("stores the transcript, suggests questions, and indexes it at the end", async () => {
    const call = await begin(a, solutionA);
    const botId = call.botId!;

    // Status event, then speech — with and without provider timestamps.
    await handleRecallEvent(
      {
        type: "status",
        botId,
        metadata: { customer_id: a.customer.id },
        code: "bot.in_call_recording",
        subCode: null,
      },
      nextId(),
    );
    const duplicate = nextId();
    const line =
      "Our warehouse system is a twenty year old Oracle Forms application and nobody dares to touch it.";
    await handleRecallEvent(
      said(botId, a.customer.id, "Dana (CTO)", line, 3.5),
      duplicate,
    );
    await handleRecallEvent(
      said(botId, a.customer.id, "Dana (CTO)", line, 3.5),
      duplicate,
    ); // retry
    await handleRecallEvent(
      said(
        botId,
        a.customer.id,
        "Dana (CTO)",
        "We need it replaced before the lease on the data centre ends in June.",
        9,
      ),
      nextId(),
    );
    await handleRecallEvent(
      said(botId, a.customer.id, "Ada", "Understood."),
      nextId(),
    );

    const live = await getLiveCallState(a.user.id, a.customer.id, call.id);
    expect(live?.active).toBe(true);
    expect(live?.call.botStatus).toBe("in_call");
    expect(live?.call.startedAt).toBeTruthy();
    expect(live?.segments.map((s) => [s.speaker, s.startMs])).toEqual([
      ["Dana (CTO)", 3500],
      ["Dana (CTO)", 9000],
      ["Ada", expect.any(Number)],
    ]);
    // Polling again with the cursor returns only what is new.
    const again = await getLiveCallState(
      a.user.id,
      a.customer.id,
      call.id,
      live!.cursor,
    );
    expect(again?.segments).toEqual([]);
    await handleRecallEvent(
      said(botId, a.customer.id, "Dana (CTO)", "June is a hard deadline."),
      nextId(),
    );
    const more = await getLiveCallState(
      a.user.id,
      a.customer.id,
      call.id,
      live!.cursor,
    );
    expect(more?.segments.map((s) => s.text)).toEqual([
      "June is a hard deadline.",
    ]);

    // Suggestions: generated from the transcript, stored, not repeated.
    llm.json = {
      suggestions: [
        {
          question: "Who maintains the Oracle Forms application today?",
          rationale: "Ownership.",
        },
        {
          question: "What happens if June is missed?",
          rationale: "Deadline risk.",
        },
      ],
    };
    const now = new Date();
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        now,
      }),
    ).toEqual({ ran: true, added: 2 });
    expect(llm.requests[0].prompt).toContain(
      "Dana (CTO): Our warehouse system is a twenty year old Oracle Forms application and nobody dares to touch it. We need it replaced",
    );
    expect(llm.requests[0].prompt).toContain("Ada: Understood.");
    // Too soon, then (later) nothing new has been said.
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        now: new Date(now.getTime() + 5_000),
      }),
    ).toEqual({ ran: false, reason: "too_soon" });
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ ran: false, reason: "not_enough_new" });
    // More speech: runs again, tells the model what it already suggested,
    // and drops an exact repeat.
    await handleRecallEvent(
      said(
        botId,
        a.customer.id,
        "Dana (CTO)",
        "The budget was approved last week, about four hundred thousand, but the board wants a fixed price and a named delivery lead before signing anything with anyone at all, and procurement insists on three competing quotes.",
      ),
      nextId(),
    );
    llm.json = {
      suggestions: [
        {
          question: "who maintains the oracle forms application today?",
          rationale: "dup",
        },
        {
          question: "Who on the board signs off?",
          rationale: "Decision maker.",
        },
      ],
    };
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        now: new Date(now.getTime() + 120_000),
      }),
    ).toEqual({ ran: true, added: 1 });
    expect(llm.requests[1].prompt).toContain(
      "- Who maintains the Oracle Forms application today?",
    );
    expect(llm.requests).toHaveLength(2);

    const withSuggestions = await getLiveCallState(
      a.user.id,
      a.customer.id,
      call.id,
    );
    expect(withSuggestions?.suggestions).toHaveLength(3);
    const first = withSuggestions!.suggestions.find((s) =>
      s.text.startsWith("Who maintains"),
    )!;
    expect(first.state).toBe("shown");
    expect(
      await setSuggestionState(
        a.user.id,
        a.customer.id,
        call.id,
        first.id,
        "asked",
      ),
    ).toBe(true);
    await expect(
      setSuggestionState(a.user.id, a.customer.id, call.id, first.id, "eaten"),
    ).rejects.toBeInstanceOf(ValidationError);

    // A failing model does not break the call.
    llm.error = new LlmError("rate_limited", "slow down");
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        force: true,
      }),
    ).toEqual({ ran: false, reason: "failed" });
    llm.error = undefined;

    // End: bot leaves, transcript becomes searchable context.
    const ended = await endCall(a.user.id, a.customer.id, call.id);
    expect(ended).toMatchObject({
      botStatus: "left",
      botStatusDetail: "ended_by_user",
    });
    expect(ended?.endedAt).toBeInstanceOf(Date);
    expect(ended?.transcriptIndexedAt).toBeInstanceOf(Date);
    expect(bot.states.get(botId)?.status).toBe("left");
    expect(
      await maybeGenerateSuggestions(a.user.id, a.customer.id, call.id, {
        force: true,
      }),
    ).toEqual({ ran: false, reason: "inactive" });

    const hits = await retrieveContext(
      a.user.id,
      a.customer.id,
      "Oracle Forms warehouse application",
    );
    expect(hits[0].source).toEqual({
      type: "call",
      id: call.id,
      title: "Discovery call",
    });
    expect(hits[0].text).toContain("Dana (CTO): Our warehouse system");

    // Late or replayed events cannot reopen it or duplicate the index.
    await handleRecallEvent(
      {
        type: "status",
        botId,
        metadata: { customer_id: a.customer.id },
        code: "bot.in_call_recording",
        subCode: null,
      },
      nextId(),
    );
    await handleRecallEvent(
      {
        type: "status",
        botId,
        metadata: { customer_id: a.customer.id },
        code: "bot.done",
        subCode: null,
      },
      nextId(),
    );
    expect((await getCall(a.user.id, a.customer.id, call.id))?.botStatus).toBe(
      "left",
    );
    const db = await getCustomerConnection(a.user.id, a.customer.id);
    expect(
      await db.select().from(chunks).where(eq(chunks.callId, call.id)),
    ).toHaveLength(1);
    expect(
      await getCallTranscript(a.user.id, a.customer.id, call.id),
    ).toHaveLength(5);
  });

  it("follows the provider's status when polled", async () => {
    const call = await begin(a, solutionA);
    bot.states.set(call.botId!, { status: "in_call", detail: null });
    expect(
      (await refreshCallStatus(a.user.id, a.customer.id, call.id))?.botStatus,
    ).toBe("in_call");
    bot.states.set(call.botId!, {
      status: "error",
      detail: "meeting_not_found",
    });
    const failed = await refreshCallStatus(a.user.id, a.customer.id, call.id);
    expect(failed).toMatchObject({
      botStatus: "error",
      botStatusDetail: "meeting_not_found",
    });
    expect(failed?.endedAt).toBeInstanceOf(Date);
  });
});

describe("isolation", () => {
  it("drops events whose customer and bot do not belong together", async () => {
    const callA = await begin(a, solutionA);
    const callB = await begin(b, solutionB);

    // B's bot id presented with A's customer id, and vice versa: no match.
    expect(
      await handleRecallEvent(
        said(callB.botId!, a.customer.id, "Mallory", "planted in A"),
        nextId(),
      ),
    ).toBe(false);
    expect(
      await handleRecallEvent(
        said(callA.botId!, b.customer.id, "Mallory", "planted in B"),
        nextId(),
      ),
    ).toBe(false);
    const forged: Record<string, string>[] = [
      {},
      { customer_id: "nope" },
      { customer_id: crypto.randomUUID() },
    ];
    for (const metadata of forged) {
      expect(
        await handleRecallEvent(
          { ...said(callA.botId!, "", "M", "x"), metadata },
          nextId(),
        ),
      ).toBe(false);
    }
    expect(
      await handleRecallEvent(
        said(callA.botId!, a.customer.id, "Dana", "real line"),
        nextId(),
      ),
    ).toBe(true);

    expect(
      (await getCallTranscript(a.user.id, a.customer.id, callA.id)).map(
        (s) => s.text,
      ),
    ).toEqual(["real line"]);
    expect(await getCallTranscript(b.user.id, b.customer.id, callB.id)).toEqual(
      [],
    );

    // A's user cannot read B's call, and B's call id means nothing in A.
    await expect(
      getLiveCallState(a.user.id, b.customer.id, callB.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    expect(
      await getLiveCallState(a.user.id, a.customer.id, callB.id),
    ).toBeNull();
    expect(await endCall(a.user.id, a.customer.id, callB.id)).toBeNull();
    expect((await getCall(b.user.id, b.customer.id, callB.id))?.botStatus).toBe(
      "joining",
    );
  });
});

describe("Recall.ai webhook endpoint", () => {
  function request(
    body: unknown,
    options: { secret?: string; ageSeconds?: number; id?: string } = {},
  ): Request {
    const rawBody = JSON.stringify(body);
    const id = options.id ?? nextId();
    const timestamp = Math.floor(Date.now() / 1000) - (options.ageSeconds ?? 0);
    return new Request("http://localhost:3000/api/webhooks/recall", {
      method: "POST",
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signRecallPayload({
          secret: options.secret ?? SECRET,
          id,
          timestamp,
          rawBody,
        }),
      },
    });
  }
  const payload = (botId: string, customerId: string, text: string) => ({
    event: "transcript.data",
    data: {
      data: {
        words: text.split(" ").map((word, i) => ({
          text: word,
          start_timestamp: { relative: 1 + i },
          end_timestamp: { relative: 1.5 + i },
        })),
        participant: { id: 1, name: "Dana" },
      },
      bot: { id: botId, metadata: { customer_id: customerId, call_id: "x" } },
    },
  });

  it("accepts a correctly signed event and stores it once", async () => {
    const call = await begin(a, solutionA);
    const body = payload(call.botId!, a.customer.id, "hello from the webhook");
    const id = nextId();
    expect((await recallWebhook(request(body, { id }))).status).toBe(200);
    expect((await recallWebhook(request(body, { id }))).status).toBe(200);
    const stored = await getCallTranscript(a.user.id, a.customer.id, call.id);
    expect(stored.map((s) => [s.speaker, s.text, s.startMs, s.endMs])).toEqual([
      ["Dana", "hello from the webhook", 1000, 4500],
    ]);
  });

  it("rejects bad signatures, stale deliveries and tampered bodies", async () => {
    const call = await begin(a, solutionA);
    const body = payload(call.botId!, a.customer.id, "forged");
    const otherSecret = `whsec_${Buffer.from("another-key").toString("base64")}`;
    expect(
      (await recallWebhook(request(body, { secret: otherSecret }))).status,
    ).toBe(401);
    expect(
      (await recallWebhook(request(body, { ageSeconds: 3600 }))).status,
    ).toBe(401);

    const signed = request(body);
    const tampered = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: JSON.stringify(payload(call.botId!, a.customer.id, "tampered")),
    });
    expect((await recallWebhook(tampered)).status).toBe(401);
    const unsigned = new Request(signed.url, { method: "POST", body: "{}" });
    expect((await recallWebhook(unsigned)).status).toBe(401);
    expect(await getCallTranscript(a.user.id, a.customer.id, call.id)).toEqual(
      [],
    );
  });

  it("acknowledges signed events it has no use for", async () => {
    expect(
      (await recallWebhook(request({ event: "something.else", data: {} })))
        .status,
    ).toBe(200);
    expect(
      (
        await recallWebhook(
          request(payload("unknown-bot", a.customer.id, "hi")),
        )
      ).status,
    ).toBe(200);
  });
});

describe("Recall.ai details", () => {
  it("verifies signatures as documented, including rotation", () => {
    const rawBody = '{"event":"x"}';
    const timestamp = 1_800_000_000;
    const now = new Date(timestamp * 1000 + 10_000);
    const good = signRecallPayload({
      secret: SECRET,
      id: "m1",
      timestamp,
      rawBody,
    });
    const headers = (signature: string): Headers =>
      new Headers({
        "webhook-id": "m1",
        "webhook-timestamp": String(timestamp),
        "webhook-signature": signature,
      });
    expect(
      verifyRecallSignature({
        secret: SECRET,
        headers: headers(good),
        rawBody,
        now,
      }),
    ).toBe(true);
    expect(
      verifyRecallSignature({
        secret: SECRET,
        headers: headers(`v1,AAAA ${good}`),
        rawBody,
        now,
      }),
    ).toBe(true);
    expect(
      verifyRecallSignature({
        secret: SECRET,
        headers: headers(good.replace("v1,", "v2,")),
        rawBody,
        now,
      }),
    ).toBe(false);
    expect(
      verifyRecallSignature({
        secret: SECRET,
        headers: headers(good),
        rawBody: rawBody + " ",
        now,
      }),
    ).toBe(false);
    expect(
      verifyRecallSignature({
        secret: undefined,
        headers: headers(good),
        rawBody,
        now,
      }),
    ).toBe(false);
    expect(
      verifyRecallSignature({
        secret: "not-a-secret",
        headers: headers(good),
        rawBody,
        now,
      }),
    ).toBe(false);
    // Legacy header names are accepted too.
    expect(
      verifyRecallSignature({
        secret: SECRET,
        headers: new Headers({
          "svix-id": "m1",
          "svix-timestamp": String(timestamp),
          "svix-signature": good,
        }),
        rawBody,
        now,
      }),
    ).toBe(true);
  });

  it("parses transcript and status events, ignoring the rest", () => {
    expect(
      parseRecallEvent({
        event: "bot.fatal",
        data: {
          data: { code: "fatal", sub_code: "meeting_not_found" },
          bot: { id: "b1", metadata: { customer_id: "c" } },
        },
      }),
    ).toEqual({
      type: "status",
      botId: "b1",
      metadata: { customer_id: "c" },
      code: "fatal",
      subCode: "meeting_not_found",
    });
    expect(
      parseRecallEvent({
        event: "transcript.data",
        data: {
          data: {
            words: [
              {
                text: "Hi",
                start_timestamp: { relative: 2 },
                end_timestamp: null,
              },
            ],
            participant: { name: null },
          },
          bot: { id: "b1", metadata: { n: 1 } },
        },
      }),
    ).toEqual({
      type: "transcript",
      botId: "b1",
      metadata: {},
      speaker: "Unknown speaker",
      text: "Hi",
      startSeconds: 2,
      endSeconds: null,
    });
    for (const body of [
      null,
      "x",
      {},
      {
        event: "transcript.data",
        data: { data: { words: [] }, bot: { id: "b" } },
      },
      { event: "transcript.data", data: {} },
    ]) {
      expect(parseRecallEvent(body)).toBeNull();
    }
    expect(mapRecallStatus("bot.in_waiting_room")).toBe("joining");
    expect(mapRecallStatus("done")).toBe("left");
    expect(mapRecallStatus("bot.breakout_room_opened")).toBeNull();
  });

  it("sends the documented Create Bot request and reads bot status", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      if (init?.method === "POST" && String(input).endsWith("/bot/")) {
        return Response.json({ id: "bot-123" }, { status: 201 });
      }
      if (String(input).endsWith("/leave_call/")) return Response.json({});
      if (String(input).includes("/bot/missing/"))
        return new Response("", { status: 404 });
      return Response.json({
        status_changes: [
          { code: "joining_call", sub_code: null },
          { code: "in_call_recording", sub_code: null },
          { code: "some_future_code", sub_code: "x" },
        ],
      });
    }) as typeof fetch;
    const recall = new RecallMeetingBot(
      {
        apiKey: "key-1",
        region: "us-west-2",
        transcriptProvider: "meeting_captions",
      },
      fake,
    );
    expect(
      await recall.createBot({
        meetingUrl: MEET,
        botName: BOT_NAME,
        webhookUrl: "https://robin.example/api/webhooks/recall",
        metadata: { customer_id: "c1" },
      }),
    ).toEqual({ botId: "bot-123" });
    expect(calls[0].url).toBe("https://us-west-2.recall.ai/api/v1/bot/");
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
      "Token key-1",
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      meeting_url: MEET,
      bot_name: BOT_NAME,
      metadata: { customer_id: "c1" },
      recording_config: {
        transcript: { provider: { meeting_captions: {} } },
        realtime_endpoints: [
          {
            type: "webhook",
            url: "https://robin.example/api/webhooks/recall",
            events: ["transcript.data"],
          },
        ],
      },
    });
    expect(await recall.getBot("bot-123")).toEqual({
      status: "in_call",
      detail: null,
    });
    await recall.leaveCall("bot-123");
    expect(calls.at(-1)?.url).toBe(
      "https://us-west-2.recall.ai/api/v1/bot/bot-123/leave_call/",
    );
    await expect(recall.getBot("missing")).rejects.toMatchObject({
      status: 404,
    });
  });
});
