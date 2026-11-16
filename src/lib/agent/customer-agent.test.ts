import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { createTenant, type Tenant } from "@/test/fixtures";

import {
  CustomerAccessDeniedError,
  CustomerArchivedError,
} from "../customer-connection";
import { archiveCustomer } from "../customers";
import { uploadFile } from "../ingestion/upload";
import { createSolution, setSolutionPhase } from "../solutions";
import { ValidationError } from "../validation";
import {
  getAgentConfig,
  getCustomerAgent,
  updateAgentConfig,
} from "./customer-agent";
import { FakeLlmClient } from "./fake-llm";
import { getLlmClient, LlmError, setLlmClient } from "./llm";
import { DOCUMENT_SYSTEM_PROMPT, SUGGESTIONS_SYSTEM_PROMPT } from "./prompts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

let a: Tenant;
let b: Tenant;
let solutionA: string;
let solutionB: string;
let llm: FakeLlmClient;

beforeAll(async () => {
  a = await createTenant("agent-a");
  b = await createTenant("agent-b");
  const sa = await createSolution(a.user.id, a.customer.id, {
    name: "Alpha order platform",
    description: "Replace the mainframe order system",
  });
  await setSolutionPhase(a.user.id, a.customer.id, sa.id, "design");
  solutionA = sa.id;
  solutionB = (
    await createSolution(b.user.id, b.customer.id, { name: "Beta data lake" })
  ).id;
  await uploadFile(a.user.id, a.customer.id, {
    name: "alpha-notes.txt",
    bytes: bytes(
      "Alpha runs orders on an AS/400 mainframe and wants Kafka event streaming.",
    ),
  });
  await uploadFile(b.user.id, b.customer.id, {
    name: "beta-notes.txt",
    bytes: bytes(
      "Beta confidential: migrating orders from Kafka event streaming to Pulsar, budget 2M.",
    ),
  });
});

beforeEach(() => {
  llm = new FakeLlmClient();
  setLlmClient(llm);
});

afterAll(async () => {
  setLlmClient(undefined);
  vi.unstubAllEnvs();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("suggestQuestions", () => {
  it("builds the prompt from this customer's solution, context and transcript", async () => {
    llm.json = {
      suggestions: [
        {
          question: " Who owns the mainframe today? ",
          rationale: "Ownership.",
        },
        { question: "", rationale: "empty is dropped" },
        { question: "Q2?", rationale: "r" },
        { question: "Q3?", rationale: "r" },
        { question: "Q4 is over the limit?", rationale: "r" },
      ],
    };
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    const suggestions = await agent.suggestQuestions({
      solutionId: solutionA,
      transcript:
        "Customer: our orders still run on the mainframe, we want Kafka event streaming.",
    });
    expect(suggestions).toEqual([
      { question: "Who owns the mainframe today?", rationale: "Ownership." },
      { question: "Q2?", rationale: "r" },
      { question: "Q3?", rationale: "r" },
    ]);

    const [request] = llm.requests;
    expect(request.system).toBe(SUGGESTIONS_SYSTEM_PROMPT);
    expect(request.effort).toBe("low");
    expect(request.model).toBeUndefined();
    expect(request.prompt).toContain("Name: Alpha order platform");
    expect(request.prompt).toContain("Phase: Solution design");
    expect(request.prompt).toContain(
      '<source id="S1" title="alpha-notes.txt">',
    );
    expect(request.prompt).toContain("AS/400 mainframe");
    expect(request.prompt).toContain("<transcript>\nCustomer: our orders");
  });

  it("never puts another customer's context in the prompt", async () => {
    // The transcript deliberately matches Beta's confidential note.
    const transcript =
      "Kafka event streaming to Pulsar migration budget confidential orders";
    await (
      await getCustomerAgent(a.user.id, a.customer.id)
    ).suggestQuestions({ solutionId: solutionA, transcript });
    await (
      await getCustomerAgent(b.user.id, b.customer.id)
    ).suggestQuestions({ solutionId: solutionB, transcript });

    const [forA, forB] = llm.requests.map((request) => request.prompt);
    expect(forA).toContain("alpha-notes.txt");
    // (The transcript itself mentions Pulsar; the leak would be Beta's note.)
    expect(forA).not.toMatch(/beta-notes|Beta confidential|budget 2M/);
    expect(forB).toContain("beta-notes.txt");
    expect(forB).toContain("budget 2M");
    expect(forB).not.toMatch(/Alpha|AS\/400/);
  });

  it("cannot be created or used across customers", async () => {
    await expect(
      getCustomerAgent(a.user.id, b.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    // A's agent asked about B's solution id finds nothing in A's database.
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    await expect(
      agent.suggestQuestions({ solutionId: solutionB, transcript: "hello" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(llm.requests).toHaveLength(0);
  });

  it("sends only the recent part of a long transcript, and nothing for an empty one", async () => {
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    expect(
      await agent.suggestQuestions({ solutionId: solutionA, transcript: "  " }),
    ).toEqual([]);
    expect(llm.requests).toHaveLength(0);

    await agent.suggestQuestions({
      solutionId: solutionA,
      transcript: "OLD-START " + "filler ".repeat(2000) + "LATEST-WORDS",
    });
    expect(llm.requests[0].prompt).toContain("LATEST-WORDS");
    expect(llm.requests[0].prompt).not.toContain("OLD-START");
  });

  it("surfaces model failures", async () => {
    llm.error = new LlmError("refused", "The model declined this request.");
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    await expect(
      agent.suggestQuestions({ solutionId: solutionA, transcript: "hello" }),
    ).rejects.toMatchObject({ reason: "refused" });
    llm.error = undefined;
    llm.json = { suggestions: [{ question: 42 }] };
    await expect(
      agent.suggestQuestions({ solutionId: solutionA, transcript: "hello" }),
    ).rejects.toThrow();
  });
});

describe("draftDocument", () => {
  it("drafts from retrieved context, streams, and returns citations", async () => {
    llm.text = "# Discovery summary\n\nOrders run on a mainframe [S1].\n";
    const streamed: string[] = [];
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    const draft = await agent.draftDocument(
      {
        solutionId: solutionA,
        title: "Discovery summary",
        brief: "Current state of the mainframe order system and goals.",
      },
      (delta) => streamed.push(delta),
    );
    expect(draft.content).toBe(
      "# Discovery summary\n\nOrders run on a mainframe [S1].",
    );
    expect(streamed.join("")).toBe(llm.text);
    expect(draft.citations).toHaveLength(1);
    expect(draft.citations[0]).toMatchObject({ location: "S1" });
    expect(draft.citations[0].chunkId).toBeTruthy();
    expect(draft.citations[0].sourceItemId).toBeTruthy();

    const [request] = llm.requests;
    expect(request.system).toBe(DOCUMENT_SYSTEM_PROMPT);
    expect(request.effort).toBe("high");
    expect(request.prompt).toContain("Draft this document: Discovery summary");
    expect(request.prompt).not.toMatch(/Beta|Pulsar/);
  });
});

describe("configuration", () => {
  it("applies per-customer instructions and model, without leaking to others", async () => {
    expect(await getAgentConfig(a.user.id, a.customer.id)).toBeUndefined();
    await updateAgentConfig(a.user.id, a.customer.id, {
      instructions: "  Always ask about SAP.  ",
      model: "claude-sonnet-5-5",
    });
    const updated = await updateAgentConfig(a.user.id, a.customer.id, {
      instructions: "Always ask about SAP integration.",
      model: "claude-sonnet-5-5",
    });
    expect(updated.id).toBe(1);

    await (
      await getCustomerAgent(a.user.id, a.customer.id)
    ).suggestQuestions({ solutionId: solutionA, transcript: "hello" });
    await (
      await getCustomerAgent(b.user.id, b.customer.id)
    ).suggestQuestions({ solutionId: solutionB, transcript: "hello" });
    const [forA, forB] = llm.requests;
    expect(forA.model).toBe("claude-sonnet-5-5");
    expect(forA.prompt).toContain("Always ask about SAP integration.");
    // The cacheable system prompt stays identical for every customer.
    expect(forA.system).toBe(forB.system);
    expect(forB.model).toBeUndefined();
    expect(forB.prompt).not.toContain("SAP");

    await expect(
      updateAgentConfig(b.user.id, a.customer.id, { instructions: "pwned" }),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    await expect(
      updateAgentConfig(a.user.id, a.customer.id, {
        instructions: "x".repeat(4001),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    // Clearing both restores the defaults.
    const cleared = await updateAgentConfig(a.user.id, a.customer.id, {});
    expect(cleared).toMatchObject({
      systemPromptOverride: null,
      modelOverride: null,
    });
  });

  it("reports a missing API key instead of calling out", () => {
    setLlmClient(undefined);
    vi.stubEnv("ROBIN_ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => getLlmClient()).toThrowError(LlmError);
    try {
      getLlmClient();
    } catch (error) {
      expect((error as LlmError).reason).toBe("not_configured");
    }
  });
});

describe("memory", () => {
  it("keeps ordered turns per session, per customer", async () => {
    const agentA = await getCustomerAgent(a.user.id, a.customer.id);
    const agentB = await getCustomerAgent(b.user.id, b.customer.id);
    await agentA.remember("s1", "user", "Draft the summary");
    await agentA.remember("s1", "assistant", "Here it is", { chunks: 3 });
    await agentA.remember("s2", "user", "Other session");
    await agentB.remember("s1", "user", "Beta's own s1");

    const turns = await agentA.recall("s1");
    expect(
      turns.map((turn) => [turn.sequence, turn.role, turn.content]),
    ).toEqual([
      [0, "user", "Draft the summary"],
      [1, "assistant", "Here it is"],
    ]);
    expect(turns[1].metadata).toEqual({ chunks: 3 });
    expect((await agentB.recall("s1")).map((turn) => turn.content)).toEqual([
      "Beta's own s1",
    ]);

    await agentA.forget("s1");
    expect(await agentA.recall("s1")).toEqual([]);
    expect(await agentA.recall("s2")).toHaveLength(1);
    expect(await agentB.recall("s1")).toHaveLength(1);
  });

  it("stops working once the customer is archived", async () => {
    const tenant = await createTenant("agent-gone");
    const agent = await getCustomerAgent(tenant.user.id, tenant.customer.id);
    await agent.remember("s", "user", "before");
    await archiveCustomer(tenant.organization.id, tenant.customer.id);
    await expect(agent.recall("s")).rejects.toBeInstanceOf(
      CustomerArchivedError,
    );
    await expect(
      agent.suggestQuestions({
        solutionId: crypto.randomUUID(),
        transcript: "x",
      }),
    ).rejects.toBeInstanceOf(CustomerArchivedError);
  });
});
