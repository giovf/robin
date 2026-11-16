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

import { FakeLlmClient } from "../agent/fake-llm";
import { LlmError, setLlmClient } from "../agent/llm";
import { DIAGRAM_SYSTEM_PROMPT } from "../agent/prompts";
import { CustomerAccessDeniedError } from "../customer-connection";
import {
  deleteDiagram,
  generateDiagram,
  getDiagram,
  listDiagrams,
  saveDiagram,
} from "../diagrams";
import { uploadFile } from "../ingestion/upload";
import {
  clearAdapters,
  registerAdapter,
  saveIntegrationConnection,
} from "../integrations";
import { FakeIntegrationAdapter } from "../integrations/fake-adapter";
import {
  isGoingAheadPhase,
  nextPhase,
  phaseDocuments,
  SOLUTION_PHASES,
} from "../phases";
import { createSolution, getSolution, setSolutionPhase } from "../solutions";
import { ValidationError } from "../validation";
import { diffLines } from "./diff";
import {
  deleteDocument,
  generateDocument,
  getDocument,
  listDocuments,
  listDocumentVersions,
  listPublications,
  publishDocumentToConfluence,
  restoreDocumentVersion,
  saveDocument,
} from "./documents";
import { markdownToXhtml } from "./markdown";
import { DOCUMENT_TEMPLATES, getDocumentTemplate } from "./templates";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

let a: Tenant;
let b: Tenant;
let solutionA: string;
let solutionB: string;
let llm: FakeLlmClient;

beforeAll(async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64"));
  a = await createTenant("doc-a");
  b = await createTenant("doc-b");
  solutionA = (
    await createSolution(a.user.id, a.customer.id, { name: "Alpha platform" })
  ).id;
  solutionB = (
    await createSolution(b.user.id, b.customer.id, { name: "Beta platform" })
  ).id;
  await uploadFile(a.user.id, a.customer.id, {
    name: "alpha-notes.txt",
    bytes: bytes("Alpha discovery summary notes: orders run on an AS/400."),
  });
});

beforeEach(() => {
  llm = new FakeLlmClient();
  setLlmClient(llm);
});

afterAll(async () => {
  setLlmClient(undefined);
  clearAdapters();
  vi.unstubAllEnvs();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("phases and templates", () => {
  it("gives every phase documents that exist as templates", () => {
    for (const phase of SOLUTION_PHASES) {
      expect(phase.documents.length).toBeGreaterThan(0);
      for (const id of phase.documents) {
        expect(getDocumentTemplate(id)?.phase, id).toBe(phase.id);
      }
    }
    // …and every template is offered by some phase.
    for (const template of DOCUMENT_TEMPLATES) {
      expect(phaseDocuments(template.phase)).toContain(template.id);
    }
    expect(phaseDocuments("made-up")).toEqual([]);
    expect(nextPhase("operations")).toBeNull();
  });

  it("marks a solution as going ahead when it enters delivery", async () => {
    expect(isGoingAheadPhase("proposal")).toBe(false);
    expect(isGoingAheadPhase("handover")).toBe(true);
    const solution = await createSolution(a.user.id, a.customer.id, {
      name: "Phase test",
    });
    const proposal = await setSolutionPhase(
      a.user.id,
      a.customer.id,
      solution.id,
      "proposal",
    );
    expect(proposal?.status).toBe("active");
    const delivery = await setSolutionPhase(
      a.user.id,
      a.customer.id,
      solution.id,
      "delivery",
    );
    expect(delivery).toMatchObject({
      currentPhase: "delivery",
      status: "going_ahead",
    });
    // Moving back does not undo the go-ahead.
    const back = await setSolutionPhase(
      a.user.id,
      a.customer.id,
      solution.id,
      "design",
    );
    expect(back?.status).toBe("going_ahead");
    expect(
      await setSolutionPhase(
        a.user.id,
        a.customer.id,
        crypto.randomUUID(),
        "design",
      ),
    ).toBeNull();
  });

  it("steers call suggestions by phase", async () => {
    const { getCustomerAgent } = await import("../agent/customer-agent");
    const agent = await getCustomerAgent(a.user.id, a.customer.id);
    await agent.suggestQuestions({
      solutionId: solutionA,
      transcript: "hello",
    });
    expect(llm.requests[0].prompt).toContain(
      "The engagement is in the Discovery phase, where what matters most is understanding the business context",
    );
  });
});

describe("documents", () => {
  let documentId: string;

  it("generates a document from a template, with citations", async () => {
    llm.text = "# Discovery summary\n\nOrders run on an AS/400 [S1].";
    const streamed: string[] = [];
    const document = await generateDocument(
      a.user.id,
      a.customer.id,
      { solutionId: solutionA, templateId: "discovery-summary" },
      (delta) => streamed.push(delta),
    );
    documentId = document.id;
    expect(document).toMatchObject({
      title: "Discovery summary",
      templateId: "discovery-summary",
      phase: "discovery",
      latestVersion: 1,
    });
    expect(streamed.join("")).toBe(llm.text);
    expect(llm.requests[0].prompt).toContain("Sections: Business context;");

    const detail = await getDocument(a.user.id, a.customer.id, documentId);
    expect(detail?.version).toMatchObject({ version: 1, createdBy: "agent" });
    expect(detail?.sources).toEqual([
      {
        marker: "S1",
        title: "alpha-notes.txt",
        sourceItemId: expect.any(String),
        callId: null,
      },
    ]);
  });

  it("stores nothing when drafting fails or the request is invalid", async () => {
    llm.error = new LlmError("refused", "no");
    await expect(
      generateDocument(a.user.id, a.customer.id, {
        solutionId: solutionA,
        templateId: "requirements",
      }),
    ).rejects.toBeInstanceOf(LlmError);
    llm.error = undefined;
    await expect(
      generateDocument(a.user.id, a.customer.id, {
        solutionId: solutionA,
        templateId: "made-up",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      generateDocument(a.user.id, a.customer.id, {
        solutionId: solutionB,
        templateId: "requirements",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      await listDocuments(a.user.id, a.customer.id, solutionA),
    ).toHaveLength(1);
  });

  it("saves edits as new versions and can restore an old one", async () => {
    const edited =
      "# Discovery summary\n\nOrders run on an AS/400 [S1].\n\nAdded by Ada.";
    expect(
      await saveDocument(a.user.id, a.customer.id, documentId, {
        title: "Discovery summary",
        content: edited.replaceAll("\n", "\r\n"),
      }),
    ).toBe(2);
    // Unchanged content: no new version; a title change alone is kept.
    expect(
      await saveDocument(a.user.id, a.customer.id, documentId, {
        title: "Acme discovery summary",
        content: edited,
      }),
    ).toBe(2);
    const current = await getDocument(a.user.id, a.customer.id, documentId);
    expect(current?.document.title).toBe("Acme discovery summary");
    expect(current?.version).toMatchObject({
      version: 2,
      createdBy: a.user.id,
      content: edited,
    });
    expect(current?.sources).toHaveLength(1);

    const first = await getDocument(a.user.id, a.customer.id, documentId, 1);
    expect(first?.version.content).not.toContain("Added by Ada");
    expect(first?.latestVersion).toBe(2);
    expect(
      await getDocument(a.user.id, a.customer.id, documentId, 99),
    ).toBeNull();

    expect(
      await restoreDocumentVersion(a.user.id, a.customer.id, documentId, 1),
    ).toBe(3);
    const restored = await getDocument(a.user.id, a.customer.id, documentId);
    expect(restored?.version.content).toBe(first?.version.content);
    expect(
      (await listDocumentVersions(a.user.id, a.customer.id, documentId)).map(
        (v) => v.version,
      ),
    ).toEqual([3, 2, 1]);

    for (const content of ["", "   ", "x".repeat(200_001)]) {
      await expect(
        saveDocument(a.user.id, a.customer.id, documentId, {
          title: "T",
          content,
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    await expect(
      saveDocument(a.user.id, a.customer.id, documentId, {
        title: "",
        content: "x",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps version numbers unique under concurrent saves", async () => {
    const results = await Promise.all(
      ["one", "two", "three"].map((content) =>
        saveDocument(a.user.id, a.customer.id, documentId, {
          title: "T",
          content,
        }),
      ),
    );
    expect(new Set(results).size).toBe(3);
  });

  it("is isolated between customers", async () => {
    await expect(
      getDocument(b.user.id, a.customer.id, documentId),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    expect(await getDocument(b.user.id, b.customer.id, documentId)).toBeNull();
    expect(
      await saveDocument(b.user.id, b.customer.id, documentId, {
        title: "T",
        content: "hijack",
      }),
    ).toBeNull();
    expect(await deleteDocument(b.user.id, b.customer.id, documentId)).toBe(
      false,
    );
    expect(await listDocuments(b.user.id, b.customer.id, solutionB)).toEqual(
      [],
    );
    expect(await listDocuments(a.user.id, a.customer.id, solutionB)).toEqual(
      [],
    );
  });

  describe("publishing to Confluence", () => {
    let adapter: FakeIntegrationAdapter;
    let connectionId: string;
    let latest: number;
    const actor = (t: Tenant) => ({
      id: t.user.id,
      organizationId: t.organization.id,
    });

    beforeAll(async () => {
      const connection = await saveIntegrationConnection({
        organizationId: a.organization.id,
        provider: "atlassian",
        account: { externalAccountId: "acc-a", label: "ada (acme)" },
        tokens: {
          accessToken: "fake-access-0",
          refreshToken: "fake-refresh",
          scopes: [],
        },
      });
      connectionId = connection.id;
    });

    beforeEach(async () => {
      adapter = new FakeIntegrationAdapter({
        provider: "atlassian",
        sources: [
          {
            kind: "confluence",
            id: "cloud-1:ARCH",
            name: "Architecture (acme)",
            selector: { cloudId: "cloud-1", spaceKey: "ARCH" },
          },
        ],
      });
      clearAdapters();
      registerAdapter(adapter);
      await saveDocument(a.user.id, a.customer.id, documentId, {
        title: "Discovery summary",
        content:
          "# Summary\n\nOrders run on an **AS/400** [S1].\n\n<script>alert(1)</script>",
      });
      latest = (await getDocument(a.user.id, a.customer.id, documentId))!
        .version.version;
    });

    const input = (overrides: object = {}) => ({
      documentId,
      reviewedVersion: latest,
      connectionId,
      spaceId: "cloud-1:ARCH",
      pageTitle: "Discovery summary",
      confirmed: true,
      ...overrides,
    });

    it("never writes without confirmation of the exact version reviewed", async () => {
      await expect(
        publishDocumentToConfluence(
          actor(a),
          a.customer.id,
          input({ confirmed: false }),
        ),
      ).rejects.toThrow(/reviewed the document/);
      await expect(
        publishDocumentToConfluence(
          actor(a),
          a.customer.id,
          input({ reviewedVersion: latest - 1 }),
        ),
      ).rejects.toThrow(/changed since you reviewed/);
      await expect(
        publishDocumentToConfluence(
          actor(a),
          a.customer.id,
          input({ spaceId: "cloud-9:SECRET" }),
        ),
      ).rejects.toThrow(/space from the list/);
      await expect(
        publishDocumentToConfluence(
          actor(a),
          a.customer.id,
          input({ pageTitle: " " }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
      expect(adapter.published).toHaveLength(0);
      expect(
        await listPublications(a.user.id, a.customer.id, documentId),
      ).toEqual([]);
    });

    it("publishes the reviewed version and records it in the audit log", async () => {
      const publication = await publishDocumentToConfluence(
        actor(a),
        a.customer.id,
        input(),
      );
      expect(adapter.published).toHaveLength(1);
      expect(adapter.published[0]).toMatchObject({
        target: { kind: "confluence", cloudId: "cloud-1", spaceKey: "ARCH" },
        title: "Discovery summary",
      });
      expect(adapter.published[0].bodyHtml).toContain(
        "<strong>AS/400</strong>",
      );
      expect(adapter.published[0].bodyHtml).not.toContain("<script>");
      expect(publication).toMatchObject({
        version: latest,
        destination: "confluence",
        targetLabel: "Architecture (acme)",
        externalId: "fake-1",
        url: "https://fake-provider.test/fake-1",
        publishedBy: a.user.id,
      });
      expect(
        await listPublications(a.user.id, a.customer.id, documentId),
      ).toHaveLength(1);
    });

    it("cannot publish through another organisation's connection or to another's document", async () => {
      // B tries A's document…
      await expect(
        publishDocumentToConfluence(actor(b), a.customer.id, input()),
      ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
      // …and A's Atlassian connection for its own customer.
      llm.text = "# Beta doc";
      const own = await generateDocument(b.user.id, b.customer.id, {
        solutionId: solutionB,
        templateId: "proposal",
      });
      await expect(
        publishDocumentToConfluence(
          actor(b),
          b.customer.id,
          input({ documentId: own.id, reviewedVersion: 1 }),
        ),
      ).rejects.toThrow(/Atlassian connection/);
      expect(adapter.published).toHaveLength(0);
    });
  });

  it("deletes a document with its versions", async () => {
    expect(await deleteDocument(a.user.id, a.customer.id, documentId)).toBe(
      true,
    );
    expect(await getDocument(a.user.id, a.customer.id, documentId)).toBeNull();
    expect(
      await listDocumentVersions(a.user.id, a.customer.id, documentId),
    ).toEqual([]);
  });
});

describe("markdownToXhtml", () => {
  it("produces well-formed XHTML and neutralises unsafe content", () => {
    const html = markdownToXhtml(
      [
        "# Title",
        "",
        "Line one  ",
        "line two with *emphasis* and `code`.",
        "",
        "---",
        "",
        "- a",
        "- b",
        "",
        "| A | B |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "[ok](https://example.com) [bad](javascript:alert(1)) ![img](https://x/y.png)",
        "",
        '<img src=x onerror="alert(1)">',
      ].join("\n"),
    );
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<br />");
    expect(html).toContain("<hr />");
    expect(html).toContain("<table>");
    expect(html).toContain('<a href="https://example.com">ok</a>');
    expect(html).not.toContain("javascript:");
    expect(html).not.toMatch(/<img/);
    expect(html).toContain("&lt;img src=x");
    // Every tag is closed or self-closed.
    expect(html).not.toMatch(/<(br|hr)>/);
  });
});

describe("diffLines", () => {
  it("reports added, removed and unchanged lines", () => {
    expect(diffLines("a\nb\nc", "a\nc\nd")).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
      { type: "added", text: "d" },
    ]);
    expect(diffLines("x", "x")).toEqual([{ type: "same", text: "x" }]);
  });
});

describe("diagrams", () => {
  it("generates, edits and deletes a diagram, per customer", async () => {
    llm.text = '```mermaid\nflowchart LR\n  A["Web shop"] --> B["AS/400"]\n```';
    const diagram = await generateDiagram(a.user.id, a.customer.id, {
      solutionId: solutionA,
      type: "architecture",
      brief: "Current order flow",
    });
    expect(diagram).toMatchObject({
      title: "Current order flow",
      format: "mermaid",
      diagramType: "architecture",
      sourceCode: 'flowchart LR\n  A["Web shop"] --> B["AS/400"]',
    });
    expect(llm.requests[0].system).toBe(DIAGRAM_SYSTEM_PROMPT);
    expect(llm.requests[0].prompt).toContain(
      "What it should show: Current order flow",
    );
    expect(llm.requests[0].prompt).toContain("alpha-notes.txt");

    await expect(
      generateDiagram(a.user.id, a.customer.id, {
        solutionId: solutionA,
        type: "pie",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const saved = await saveDiagram(a.user.id, a.customer.id, diagram.id, {
      title: "Order flow",
      sourceCode: "flowchart LR\n  A --> C\n",
    });
    expect(saved?.sourceCode).toBe("flowchart LR\n  A --> C");
    await expect(
      saveDiagram(a.user.id, a.customer.id, diagram.id, {
        title: "T",
        sourceCode: " ",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await getDiagram(b.user.id, b.customer.id, diagram.id)).toBeNull();
    expect(
      await saveDiagram(b.user.id, b.customer.id, diagram.id, {
        title: "T",
        sourceCode: "x",
      }),
    ).toBeNull();
    expect(await deleteDiagram(b.user.id, b.customer.id, diagram.id)).toBe(
      false,
    );
    await expect(
      listDiagrams(b.user.id, a.customer.id, solutionA),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);

    expect(
      await listDiagrams(a.user.id, a.customer.id, solutionA),
    ).toHaveLength(1);
    expect(await deleteDiagram(a.user.id, a.customer.id, diagram.id)).toBe(
      true,
    );
    expect((await getSolution(a.user.id, a.customer.id, solutionA))?.name).toBe(
      "Alpha platform",
    );
  });
});
