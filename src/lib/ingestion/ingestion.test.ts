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

import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import {
  chunks,
  EMBEDDING_DIMENSIONS,
  sourceItems,
} from "@/db/customer/schema";
import { createTenant, type Tenant } from "@/test/fixtures";

import { chunkText } from "../chunking";
import {
  CustomerAccessDeniedError,
  getCustomerConnection,
} from "../customer-connection";
import { addCustomerSource, listCustomerSources } from "../customer-sources";
import {
  LocalHashEmbeddingProvider,
  setEmbeddingProvider,
  type EmbeddingProvider,
} from "../embeddings";
import {
  clearAdapters,
  IntegrationError,
  registerAdapter,
  saveIntegrationConnection,
} from "../integrations";
import { FakeIntegrationAdapter } from "../integrations/fake-adapter";
import type { ContentItem } from "../integrations/types";
import {
  deleteSourceItem,
  getKnowledgeTotals,
  getSourceItem,
  listSourceItems,
} from "../knowledge";
import { retrieveContext } from "../retrieval";
import { extractText } from "../text-extraction";
import { ValidationError } from "../validation";
import { syncCustomerSource } from "./sync";
import { uploadFile } from "./upload";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  a = await createTenant("ing-a");
  b = await createTenant("ing-b");
});

beforeEach(() => setEmbeddingProvider(undefined));

afterAll(async () => {
  vi.unstubAllEnvs();
  clearAdapters();
  setEmbeddingProvider(undefined);
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("chunkText", () => {
  it("keeps short text whole and drops blank paragraphs", () => {
    expect(chunkText("One.\n\n\n\n  \n\nTwo.")).toEqual(["One.\n\nTwo."]);
    expect(chunkText("   ")).toEqual([]);
  });

  it("respects the size limit and overlaps neighbouring chunks", () => {
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) => `Paragraph ${i} ` + "lorem ipsum dolor sit amet ".repeat(6),
    );
    const result = chunkText(paragraphs.join("\n\n"), {
      maxChars: 500,
      overlapChars: 80,
    });
    expect(result.length).toBeGreaterThan(3);
    for (const chunk of result) expect(chunk.length).toBeLessThanOrEqual(500);
    for (let i = 0; i < 12; i++) {
      expect(result.some((chunk) => chunk.includes(`Paragraph ${i} `))).toBe(
        true,
      );
    }
    // Each chunk after the first starts with the tail of the one before.
    for (let i = 1; i < result.length; i++) {
      const head = result[i].split("\n\n")[0];
      expect(result[i - 1].endsWith(head)).toBe(true);
    }
  });

  it("splits one enormous paragraph at sentence ends without losing text", () => {
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const result = chunkText(sentence.repeat(100), {
      maxChars: 400,
      overlapChars: 0,
    });
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(400);
      expect(chunk.endsWith(".")).toBe(true);
    }
    expect(result.join(" ")).toBe(sentence.repeat(100).trim());
    // No boundaries at all: still bounded.
    for (const chunk of chunkText("x".repeat(1000), { maxChars: 300 })) {
      expect(chunk.length).toBeLessThanOrEqual(300);
    }
  });
});

describe("local embeddings", () => {
  it("produces unit vectors where shared words mean closer", async () => {
    const provider = new LocalHashEmbeddingProvider();
    const [kafka, kafka2, lunch, empty] = await provider.embed([
      "We will use Kafka for event streaming",
      "Kafka event streaming is the plan",
      "Lunch menu: soup and sandwiches",
      "",
    ]);
    const dot = (x: number[], y: number[]): number =>
      x.reduce((sum, value, i) => sum + value * y[i], 0);
    expect(kafka).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(dot(kafka, kafka)).toBeCloseTo(1, 6);
    expect(dot(kafka, kafka2)).toBeGreaterThan(dot(kafka, lunch) + 0.2);
    expect(dot(empty, empty)).toBeCloseTo(1, 6);
  });

  it("refuses a provider whose vectors do not fit the column", () => {
    const wrong: EmbeddingProvider = {
      id: "tiny",
      dimensions: 8,
      embed: async (texts) => texts.map(() => new Array(8).fill(0)),
    };
    expect(() => setEmbeddingProvider(wrong)).toThrow(/8 dimensions/);
  });
});

describe("extractText", () => {
  it("reads text, markdown and HTML", async () => {
    expect(
      await extractText({ name: "notes.md", bytes: bytes("# Title\n\nBody") }),
    ).toBe("# Title\n\nBody");
    expect(
      await extractText({
        name: "page.HTML",
        bytes: bytes(
          "<html><style>p{}</style><p>Hello&nbsp;<b>world</b></p><p>Bye</p></html>",
        ),
      }),
    ).toBe("Hello world\nBye");
  });

  it("reads a real PDF and a real DOCX", async () => {
    const pdf = await minimalPdf("Robin PDF fixture text");
    expect(await extractText({ name: "doc.pdf", bytes: pdf })).toContain(
      "Robin PDF fixture text",
    );
    const docx = await minimalDocx("Robin DOCX fixture text");
    expect(await extractText({ name: "doc.docx", bytes: docx })).toContain(
      "Robin DOCX fixture text",
    );
  });

  it("rejects unsupported, broken, binary and empty files", async () => {
    for (const file of [
      { name: "virus.exe", bytes: bytes("MZ") },
      { name: "no-extension", bytes: bytes("text") },
      { name: "broken.pdf", bytes: bytes("not a pdf") },
      { name: "broken.docx", bytes: bytes("not a zip") },
      { name: "binary.txt", bytes: new Uint8Array([0xff, 0xfe, 0xfd]) },
      { name: "empty.txt", bytes: bytes("  \n ") },
    ]) {
      await expect(extractText(file), file.name).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });
});

describe("upload and retrieval", () => {
  it("ingests an upload into chunks with embeddings", async () => {
    const text = [
      "Acme runs its order system on an AS/400 mainframe.",
      "The integration layer uses nightly batch files over SFTP.",
      "They want to move to event streaming with Kafka within a year.",
    ].join("\n\n");
    const result = await uploadFile(a.user.id, a.customer.id, {
      name: "acme-discovery.txt",
      bytes: bytes(text),
    });
    expect(result).toMatchObject({ changed: true, chunkCount: 1 });
    expect(result.sourceItem).toMatchObject({
      provider: "upload",
      title: "acme-discovery.txt",
    });

    const db = await getCustomerConnection(a.user.id, a.customer.id);
    const [chunk] = await db
      .select()
      .from(chunks)
      .where(eq(chunks.sourceItemId, result.sourceItem.id));
    expect(chunk.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(chunk.embeddingModel).toBe("local-hash-v1");

    // The same file again changes nothing.
    const again = await uploadFile(a.user.id, a.customer.id, {
      name: "acme-discovery.txt",
      bytes: bytes(text),
    });
    expect(again.changed).toBe(false);
    expect(again.sourceItem.id).toBe(result.sourceItem.id);
    expect(await getKnowledgeTotals(a.user.id, a.customer.id)).toEqual({
      itemCount: 1,
      chunkCount: 1,
    });
  });

  it("retrieves the most relevant chunks, with their source", async () => {
    await uploadFile(a.user.id, a.customer.id, {
      name: "lunch.txt",
      bytes: bytes("The canteen serves soup and sandwiches on Fridays."),
    });
    const results = await retrieveContext(
      a.user.id,
      a.customer.id,
      "event streaming with Kafka",
    );
    expect(results).toHaveLength(2);
    expect(results[0].text).toContain("Kafka");
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
    expect(results[0].source).toMatchObject({
      type: "source_item",
      provider: "upload",
      title: "acme-discovery.txt",
    });

    expect(
      await retrieveContext(a.user.id, a.customer.id, "Kafka", { limit: 1 }),
    ).toHaveLength(1);
    const strict = await retrieveContext(a.user.id, a.customer.id, "Kafka", {
      minSimilarity: 0.05,
    });
    expect(
      strict.map((r) => r.source.type === "source_item" && r.source.title),
    ).toEqual(["acme-discovery.txt"]);
    expect(
      await retrieveContext(a.user.id, a.customer.id, "Kafka", {
        providers: ["jira"],
      }),
    ).toEqual([]);
    expect(
      await retrieveContext(a.user.id, a.customer.id, "Kafka", {
        syncedSince: new Date(Date.now() + 60_000),
      }),
    ).toEqual([]);
    expect(await retrieveContext(a.user.id, a.customer.id, "  ")).toEqual([]);
  });

  it("ignores chunks embedded by a different model", async () => {
    setEmbeddingProvider({
      id: "other-model",
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async (texts) =>
        texts.map(() => {
          const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
          v[1] = 1;
          return v;
        }),
    });
    expect(await retrieveContext(a.user.id, a.customer.id, "Kafka")).toEqual(
      [],
    );
    // Re-uploading under the new model re-embeds instead of skipping.
    const redo = await uploadFile(a.user.id, a.customer.id, {
      name: "lunch.txt",
      bytes: bytes("The canteen serves soup and sandwiches on Fridays."),
    });
    expect(redo.changed).toBe(true);
    expect(
      await retrieveContext(a.user.id, a.customer.id, "anything"),
    ).toHaveLength(1);
  });

  it("never crosses customers", async () => {
    await uploadFile(b.user.id, b.customer.id, {
      name: "beta-secret.txt",
      bytes: bytes("Beta plans a confidential Kafka migration to Pulsar."),
    });
    const seenByA = await retrieveContext(a.user.id, a.customer.id, "Kafka");
    expect(JSON.stringify(seenByA)).not.toContain("Beta");
    const seenByB = await retrieveContext(b.user.id, b.customer.id, "Kafka");
    expect(seenByB).toHaveLength(1);
    expect(seenByB[0].text).toContain("Pulsar");

    for (const attempt of [
      () => retrieveContext(a.user.id, b.customer.id, "Kafka"),
      () =>
        uploadFile(a.user.id, b.customer.id, {
          name: "x.txt",
          bytes: bytes("planted"),
        }),
      () => listSourceItems(a.user.id, b.customer.id),
      () => getKnowledgeTotals(a.user.id, b.customer.id),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    }
    expect(await getKnowledgeTotals(b.user.id, b.customer.id)).toEqual({
      itemCount: 1,
      chunkCount: 1,
    });
  });

  it("browses and deletes ingested items", async () => {
    const items = await listSourceItems(a.user.id, a.customer.id);
    expect(items.map((item) => [item.title, item.chunkCount]).sort()).toEqual([
      ["acme-discovery.txt", 1],
      ["lunch.txt", 1],
    ]);
    const lunch = items.find((item) => item.title === "lunch.txt")!;
    const detail = await getSourceItem(a.user.id, a.customer.id, lunch.id);
    expect(detail?.chunks[0].text).toContain("canteen");

    // B cannot read or delete A's item through its own customer.
    expect(await getSourceItem(b.user.id, b.customer.id, lunch.id)).toBeNull();
    expect(await deleteSourceItem(b.user.id, b.customer.id, lunch.id)).toBe(
      false,
    );
    expect(await deleteSourceItem(a.user.id, a.customer.id, lunch.id)).toBe(
      true,
    );
    expect(await getSourceItem(a.user.id, a.customer.id, lunch.id)).toBeNull();
    const db = await getCustomerConnection(a.user.id, a.customer.id);
    expect(
      await db.select().from(chunks).where(eq(chunks.sourceItemId, lunch.id)),
    ).toEqual([]);
  });
});

describe("integration sync", () => {
  const mails = (
    count: number,
    body = "about the Kafka rollout",
  ): ContentItem[] =>
    Array.from({ length: count }, (_, i) => ({
      externalId: `m${i}`,
      title: `Mail ${i}`,
      url: `https://mail.test/m${i}`,
      text: `Mail ${i} ${body}`,
    }));

  function useAdapter(content: ContentItem[]): FakeIntegrationAdapter {
    const adapter = new FakeIntegrationAdapter({
      provider: "google",
      sources: [
        { kind: "gmail", id: "L1", name: "Acme", selector: { id: "L1" } },
      ],
      content: { L1: content },
      pageSize: 2,
    });
    clearAdapters();
    registerAdapter(adapter);
    return adapter;
  }

  let tenant: Tenant;
  let sourceId: string;
  const actor = (): { id: string; organizationId: string } => ({
    id: tenant.user.id,
    organizationId: tenant.organization.id,
  });

  beforeAll(async () => {
    tenant = await createTenant("sync");
    useAdapter(mails(5));
    const connection = await saveIntegrationConnection({
      organizationId: tenant.organization.id,
      provider: "google",
      account: { externalAccountId: "sub-sync", label: "sync@example.test" },
      tokens: {
        accessToken: "fake-access-0",
        refreshToken: "fake-refresh",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: [],
      },
    });
    const source = await addCustomerSource(
      tenant.organization.id,
      tenant.customer.id,
      { connectionId: connection.id, kind: "gmail", sourceId: "L1" },
    );
    sourceId = source!.id;
  });

  it("ingests every page and records the outcome", async () => {
    useAdapter(mails(5));
    const result = await syncCustomerSource(
      actor(),
      tenant.customer.id,
      sourceId,
    );
    expect(result).toEqual({ status: "ok", itemCount: 5, changedCount: 5 });

    const items = await listSourceItems(tenant.user.id, tenant.customer.id, {
      customerSourceId: sourceId,
    });
    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ provider: "gmail", chunkCount: 1 });
    const [source] = (await listCustomerSources(
      tenant.organization.id,
      tenant.customer.id,
    ))!;
    expect(source).toMatchObject({
      lastSyncStatus: "ok",
      lastSyncItemCount: 5,
      lastSyncError: null,
    });
    expect(source.lastSyncedAt).toBeInstanceOf(Date);

    const hits = await retrieveContext(
      tenant.user.id,
      tenant.customer.id,
      "Kafka rollout",
      { providers: ["gmail"] },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toMatchObject({ url: "https://mail.test/m0" });
  });

  it("re-ingests only what changed", async () => {
    const changed = mails(5);
    changed[3] = { ...changed[3], text: "Mail 3 now mentions Pulsar instead" };
    changed.push({ externalId: "m9", title: "New", text: "A brand new mail" });
    useAdapter(changed);
    const result = await syncCustomerSource(
      actor(),
      tenant.customer.id,
      sourceId,
    );
    expect(result).toEqual({ status: "ok", itemCount: 6, changedCount: 2 });
    const db = await getCustomerConnection(tenant.user.id, tenant.customer.id);
    expect(await db.select().from(sourceItems)).toHaveLength(6);
    const [m3] = await db
      .select()
      .from(sourceItems)
      .where(eq(sourceItems.externalId, "m3"));
    const pieces = await db
      .select()
      .from(chunks)
      .where(eq(chunks.sourceItemId, m3.id));
    expect(pieces.map((piece) => piece.text)).toEqual([
      "Mail 3 now mentions Pulsar instead",
    ]);
  });

  it("records a generic error when the provider fails, keeping earlier data", async () => {
    const adapter = useAdapter(mails(5));
    adapter.fetchContent = async () => {
      throw new IntegrationError("401 for mailbox of cto@acme.test", 401);
    };
    const result = await syncCustomerSource(
      actor(),
      tenant.customer.id,
      sourceId,
    );
    expect(result).toMatchObject({
      status: "error",
      error: "The account needs reconnecting.",
    });
    const [source] = (await listCustomerSources(
      tenant.organization.id,
      tenant.customer.id,
    ))!;
    expect(source.lastSyncStatus).toBe("error");
    expect(source.lastSyncError).not.toContain("acme");
    expect(
      await listSourceItems(tenant.user.id, tenant.customer.id),
    ).toHaveLength(6);
  });

  it("refuses a second run while one is in progress", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const adapter = useAdapter(mails(1));
    const original = adapter.fetchContent.bind(adapter);
    adapter.fetchContent = async (...args) => {
      await gate;
      return original(...args);
    };
    const first = syncCustomerSource(actor(), tenant.customer.id, sourceId);
    await vi.waitFor(async () => {
      const [source] = (await listCustomerSources(
        tenant.organization.id,
        tenant.customer.id,
      ))!;
      expect(source.lastSyncStatus).toBe("running");
    });
    expect(
      (await syncCustomerSource(actor(), tenant.customer.id, sourceId)).status,
    ).toBe("already_running");
    release();
    expect((await first).status).toBe("ok");
  });

  it("cannot be triggered across customers", async () => {
    await expect(
      syncCustomerSource(
        { id: a.user.id, organizationId: a.organization.id },
        tenant.customer.id,
        sourceId,
      ),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    // A's user pairing its own customer with someone else's source id.
    expect(
      await syncCustomerSource(
        { id: a.user.id, organizationId: a.organization.id },
        a.customer.id,
        sourceId,
      ),
    ).toMatchObject({ status: "not_found" });
  });
});

/** Builds a tiny one-page PDF containing `text`. */
async function minimalPdf(text: string): Promise<Uint8Array> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objects[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return bytes(pdf);
}

/** Builds a tiny DOCX (a zip with stored entries) containing `text`. */
async function minimalDocx(text: string): Promise<Uint8Array> {
  const { crc32 } = await import("node:zlib");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ],
  ];
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc32(data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, ...central, end]));
}
