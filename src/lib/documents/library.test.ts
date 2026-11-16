import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { diagrams, documents, documentVersions } from "@/db/customer/schema";
import { createTenant, type Tenant } from "@/test/fixtures";

import {
  CustomerAccessDeniedError,
  getCustomerConnection,
} from "../customer-connection";
import {
  clearAdapters,
  enabledProviders,
  isIntegrationEnabled,
  resolveAdapter,
} from "../integrations";
import { createSolution } from "../solutions";
import { listCustomerLibrary } from "./library";

let a: Tenant;
let b: Tenant;

async function addDocument(
  tenant: Tenant,
  solutionId: string,
  title: string,
  versions: number,
): Promise<string> {
  const db = await getCustomerConnection(tenant.user.id, tenant.customer.id);
  const [document] = await db
    .insert(documents)
    .values({ solutionId, title, phase: "discovery" })
    .returning();
  for (let version = 1; version <= versions; version++) {
    await db.insert(documentVersions).values({
      documentId: document.id,
      version,
      content: `# ${title}\n\nVersion ${version}.`,
      citations: [],
      createdBy: "user",
    });
  }
  return document.id;
}

beforeAll(async () => {
  a = await createTenant("lib-a");
  b = await createTenant("lib-b");
});

afterAll(async () => {
  clearAdapters();
  vi.unstubAllEnvs();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("listCustomerLibrary", () => {
  it("groups documents and diagrams by solution and skips empty solutions", async () => {
    const zeta = await createSolution(a.user.id, a.customer.id, {
      name: "Zeta",
    });
    const alpha = await createSolution(a.user.id, a.customer.id, {
      name: "alpha",
    });
    await createSolution(a.user.id, a.customer.id, { name: "Empty" });
    const overview = await addDocument(a, alpha.id, "Overview", 3);
    const runbook = await addDocument(a, zeta.id, "Runbook", 1);
    const db = await getCustomerConnection(a.user.id, a.customer.id);
    const [diagram] = await db
      .insert(diagrams)
      .values({
        solutionId: zeta.id,
        title: "Context",
        sourceCode: "flowchart LR\n  a --> b",
        diagramType: "architecture",
      })
      .returning();

    const library = await listCustomerLibrary(a.user.id, a.customer.id);
    expect(library.map((solution) => solution.name)).toEqual(["alpha", "Zeta"]);
    expect(library[0].documents).toMatchObject([
      { id: overview, title: "Overview", latestVersion: 3, phase: "discovery" },
    ]);
    expect(library[0].diagrams).toEqual([]);
    expect(library[1].documents).toMatchObject([
      { id: runbook, latestVersion: 1 },
    ]);
    expect(library[1].diagrams).toMatchObject([
      { id: diagram.id, title: "Context" },
    ]);
  });

  it("never shows another customer's documents", async () => {
    const solution = await createSolution(b.user.id, b.customer.id, {
      name: "Beta only",
    });
    await addDocument(b, solution.id, "Beta secret", 1);

    const mine = await listCustomerLibrary(a.user.id, a.customer.id);
    expect(JSON.stringify(mine)).not.toContain("Beta secret");
    await expect(
      listCustomerLibrary(a.user.id, b.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
  });
});

describe("integration add-ons", () => {
  it("switches on only Google unless told otherwise", () => {
    vi.stubEnv("ENABLED_INTEGRATIONS", undefined);
    expect(isIntegrationEnabled("google")).toBe(true);
    expect(isIntegrationEnabled("atlassian")).toBe(false);
    expect(enabledProviders().map((info) => info.provider)).toEqual(["google"]);
  });

  it("does not build an adapter for an add-on that is off", () => {
    clearAdapters();
    vi.stubEnv("ATLASSIAN_CLIENT_ID", "id");
    vi.stubEnv("ATLASSIAN_CLIENT_SECRET", "secret");
    vi.stubEnv("ENABLED_INTEGRATIONS", "google");
    expect(resolveAdapter("atlassian")).toBeNull();
    vi.stubEnv("ENABLED_INTEGRATIONS", " Google , Atlassian ");
    expect(resolveAdapter("atlassian")?.provider).toBe("atlassian");
  });
});
