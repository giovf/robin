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

import {
  closeControlPlaneDb,
  getControlPlaneDb,
} from "@/db/control-plane/connection";
import {
  integrationConnections,
  organizations,
} from "@/db/control-plane/schema";

import { decryptToken, encryptToken } from "../encryption";
import { FakeIntegrationAdapter } from "./fake-adapter";
import {
  clearAdapters,
  deleteIntegrationConnection,
  getAdapter,
  getIntegrationTokens,
  hasAdapter,
  listAdapters,
  listIntegrationConnections,
  registerAdapter,
  saveIntegrationConnection,
  updateIntegrationTokens,
} from "./index";

const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY_A);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeControlPlaneDb();
});

describe("token encryption", () => {
  it("round-trips, with a different ciphertext every time", () => {
    const first = encryptToken("ya29.secret-token");
    const second = encryptToken("ya29.secret-token");
    expect(first).not.toContain("ya29");
    expect(first).not.toBe(second);
    expect(decryptToken(first)).toBe("ya29.secret-token");
    expect(decryptToken(encryptToken(""))).toBe("");
    expect(decryptToken(encryptToken("ünï:code:✓"))).toBe("ünï:code:✓");
  });

  it("fails with the wrong key", () => {
    const encrypted = encryptToken("secret");
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", KEY_B);
    expect(() => decryptToken(encrypted)).toThrow();
  });

  it("detects tampering", () => {
    const [version, iv, tag, ciphertext] = encryptToken("secret").split(":");
    const flipped = Buffer.from(ciphertext, "base64");
    flipped[0] ^= 1;
    expect(() =>
      decryptToken([version, iv, tag, flipped.toString("base64")].join(":")),
    ).toThrow();
    expect(() => decryptToken("not-encrypted")).toThrow(/unknown format/);
    expect(() => decryptToken(["v0", iv, tag, ciphertext].join(":"))).toThrow(
      /unknown format/,
    );
  });

  it("rejects a missing or wrongly sized key", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "c2hvcnQ=");
    expect(() => encryptToken("secret")).toThrow(/32 bytes/);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptToken("secret")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe("adapter registry", () => {
  beforeEach(clearAdapters);

  it("registers and returns adapters by provider", () => {
    expect(hasAdapter("google")).toBe(false);
    expect(() => getAdapter("google")).toThrow(/No integration adapter/);
    const google = new FakeIntegrationAdapter({ provider: "google" });
    const atlassian = new FakeIntegrationAdapter({ provider: "atlassian" });
    registerAdapter(google);
    registerAdapter(atlassian);
    expect(getAdapter("google")).toBe(google);
    expect(getAdapter("atlassian")).toBe(atlassian);
    expect(listAdapters()).toHaveLength(2);
  });
});

describe("fake adapter (the adapter contract)", () => {
  const adapter = new FakeIntegrationAdapter({
    sources: [
      { kind: "gmail", id: "L1", name: "Acme", selector: { id: "L1" } },
      { kind: "google_drive", id: "F1", name: "Docs", selector: { id: "F1" } },
    ],
    content: {
      L1: [1, 2, 3].map((n) => ({
        externalId: `m${n}`,
        title: `Mail ${n}`,
        text: `Body ${n}`,
      })),
    },
    pageSize: 2,
  });

  it("runs the OAuth flow", async () => {
    const url = new URL(
      adapter.getAuthorizationUrl({
        state: "xyz",
        redirectUri: "http://localhost:3000/cb",
      }),
    );
    expect(url.searchParams.get("state")).toBe("xyz");
    await expect(
      adapter.exchangeCodeForTokens({ code: "bad" }),
    ).rejects.toThrow();
    const tokens = await adapter.exchangeCodeForTokens({ code: "valid-code" });
    const refreshed = await adapter.refreshTokens(tokens.refreshToken!);
    expect(refreshed.accessToken).not.toBe(tokens.accessToken);
    expect(refreshed.refreshToken).toBeUndefined();
  });

  it("lists sources by kind and pages through content", async () => {
    const tokens = await adapter.exchangeCodeForTokens({ code: "valid-code" });
    const [label] = await adapter.listSources(tokens, "gmail");
    expect(label.name).toBe("Acme");
    expect(await adapter.listSources(tokens, "jira")).toEqual([]);

    const first = await adapter.fetchContent(tokens, label);
    expect(first.items).toHaveLength(2);
    const second = await adapter.fetchContent(
      tokens,
      label,
      first.nextPageToken,
    );
    expect(second.items.map((item) => item.externalId)).toEqual(["m3"]);
    expect(second.nextPageToken).toBeUndefined();
  });
});

describe("integration connections", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const rows = await getControlPlaneDb()
      .insert(organizations)
      .values([{ name: "Int A" }, { name: "Int B" }])
      .returning();
    [orgA, orgB] = rows.map((row) => row.id);
  });

  it("stores tokens encrypted and returns them decrypted to the owner only", async () => {
    const connection = await saveIntegrationConnection({
      organizationId: orgA,
      provider: "google",
      account: { externalAccountId: "sub-1", label: "ada@example.test" },
      tokens: {
        accessToken: "access-plain",
        refreshToken: "refresh-plain",
        scopes: ["gmail.readonly"],
      },
    });
    expect(JSON.stringify(connection)).not.toMatch(/plain|encrypted/i);

    const [row] = await getControlPlaneDb()
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id));
    expect(row.encryptedAccessToken).not.toContain("access-plain");
    expect(row.encryptedRefreshToken).not.toContain("refresh-plain");

    expect(await getIntegrationTokens(orgA, connection.id)).toMatchObject({
      accessToken: "access-plain",
      refreshToken: "refresh-plain",
      scopes: ["gmail.readonly"],
    });
    expect(await getIntegrationTokens(orgB, connection.id)).toBeNull();
    expect(await listIntegrationConnections(orgB)).toEqual([]);
    expect(await listIntegrationConnections(orgA)).toHaveLength(1);

    // A refresh without a new refresh token keeps the stored one.
    expect(
      await updateIntegrationTokens(orgB, connection.id, {
        accessToken: "stolen",
        scopes: [],
      }),
    ).toBe(false);
    expect(
      await updateIntegrationTokens(orgA, connection.id, {
        accessToken: "access-2",
        scopes: ["gmail.readonly"],
      }),
    ).toBe(true);
    expect(await getIntegrationTokens(orgA, connection.id)).toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-plain",
    });

    expect(await deleteIntegrationConnection(orgB, connection.id)).toBe(false);
    expect(await deleteIntegrationConnection(orgA, connection.id)).toBe(true);
    expect(await getIntegrationTokens(orgA, connection.id)).toBeNull();
  });
});
