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

import { GET as authorizeRoute } from "@/app/api/integrations/[provider]/authorize/route";
import { GET as callbackRoute } from "@/app/api/integrations/[provider]/callback/route";
import {
  closeControlPlaneDb,
  getControlPlaneDb,
} from "@/db/control-plane/connection";
import { integrationConnections, memberships } from "@/db/control-plane/schema";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { createTenant, signUpUser, type Tenant } from "@/test/fixtures";

import {
  addCustomerSource,
  addGmailQuerySource,
  listAvailableSources,
  listCustomerSources,
  removeCustomerSource,
} from "./customer-sources";
import { archiveCustomer } from "./customers";
import {
  clearAdapters,
  getFreshIntegrationTokens,
  getIntegrationTokens,
  IntegrationError,
  listIntegrationConnections,
  registerAdapter,
  saveIntegrationConnection,
} from "./integrations";
import { FakeIntegrationAdapter } from "./integrations/fake-adapter";
import { completeOAuth, startOAuth } from "./integrations/oauth-flow";
import { ValidationError } from "./validation";

let a: Tenant;
let b: Tenant;
let connectionA: string;
let connectionB: string;

function useFakeGoogle(): FakeIntegrationAdapter {
  const adapter = new FakeIntegrationAdapter({
    provider: "google",
    sources: [
      { kind: "gmail", id: "L1", name: "Acme", selector: { labelIds: ["L1"] } },
      { kind: "gmail", id: "L2", name: "Beta", selector: { labelIds: ["L2"] } },
      {
        kind: "google_drive",
        id: "F1",
        name: "Acme docs",
        selector: { folderId: "F1" },
      },
    ],
  });
  clearAdapters();
  registerAdapter(adapter);
  return adapter;
}

async function connect(organizationId: string, sub: string): Promise<string> {
  const connection = await saveIntegrationConnection({
    organizationId,
    provider: "google",
    account: { externalAccountId: sub, label: `${sub}@example.test` },
    tokens: {
      accessToken: "fake-access-0",
      refreshToken: "fake-refresh",
      expiresAt: new Date(Date.now() + 3_600_000),
      scopes: ["fake.read"],
    },
  });
  return connection.id;
}

beforeAll(async () => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("ALLOW_SIGNUP", "true");
  a = await createTenant("src-a");
  b = await createTenant("src-b");
  connectionA = await connect(a.organization.id, "sub-a");
  connectionB = await connect(b.organization.id, "sub-b");
});

beforeEach(useFakeGoogle);

afterAll(async () => {
  vi.unstubAllEnvs();
  clearAdapters();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("customer sources", () => {
  it("lists what a connection offers", async () => {
    const labels = await listAvailableSources(
      a.organization.id,
      connectionA,
      "gmail",
    );
    expect(labels.map((label) => label.name)).toEqual(["Acme", "Beta"]);
    expect(
      await listAvailableSources(a.organization.id, connectionA, "jira"),
    ).toEqual([]);
  });

  it("adds a source using the provider's data, not the caller's", async () => {
    const added = await addCustomerSource(a.organization.id, a.customer.id, {
      connectionId: connectionA,
      kind: "gmail",
      sourceId: "L1",
    });
    expect(added).toMatchObject({
      kind: "gmail",
      name: "Acme",
      selector: { labelIds: ["L1"] },
    });
    // Adding it again does not duplicate it.
    const again = await addCustomerSource(a.organization.id, a.customer.id, {
      connectionId: connectionA,
      kind: "gmail",
      sourceId: "L1",
    });
    expect(again?.id).toBe(added?.id);

    await expect(
      addCustomerSource(a.organization.id, a.customer.id, {
        connectionId: connectionA,
        kind: "gmail",
        sourceId: "not-offered",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      addCustomerSource(a.organization.id, a.customer.id, {
        connectionId: connectionA,
        kind: "smoke-signals",
        sourceId: "L1",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("adds a Gmail search and removes sources", async () => {
    const search = await addGmailQuerySource(a.organization.id, a.customer.id, {
      connectionId: connectionA,
      query: " from:acme.com ",
    });
    expect(search).toMatchObject({
      name: "Search: from:acme.com",
      selector: { query: "from:acme.com" },
    });
    await expect(
      addGmailQuerySource(a.organization.id, a.customer.id, {
        connectionId: connectionA,
        query: "",
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    const listed = await listCustomerSources(a.organization.id, a.customer.id);
    expect(listed?.map((source) => source.name)).toEqual([
      "Acme",
      "Search: from:acme.com",
    ]);
    expect(
      await removeCustomerSource(a.organization.id, a.customer.id, search!.id),
    ).toBe(true);
    expect(
      await removeCustomerSource(a.organization.id, a.customer.id, search!.id),
    ).toBe(false);
  });

  it("is isolated between organisations and customers", async () => {
    const [mine] = (await listCustomerSources(
      a.organization.id,
      a.customer.id,
    ))!;

    // B cannot see, add to, or remove from A's customer…
    expect(
      await listCustomerSources(b.organization.id, a.customer.id),
    ).toBeNull();
    expect(
      await addCustomerSource(b.organization.id, a.customer.id, {
        connectionId: connectionB,
        kind: "gmail",
        sourceId: "L2",
      }),
    ).toBeNull();
    expect(
      await removeCustomerSource(b.organization.id, a.customer.id, mine.id),
    ).toBe(false);
    // …nor remove A's source by pairing it with its own customer…
    expect(
      await removeCustomerSource(b.organization.id, b.customer.id, mine.id),
    ).toBe(false);
    // …nor attach A's connection (A's mailbox) to its own customer.
    expect(
      await addCustomerSource(b.organization.id, b.customer.id, {
        connectionId: connectionA,
        kind: "gmail",
        sourceId: "L1",
      }),
    ).toBeNull();
    expect(
      await addGmailQuerySource(b.organization.id, b.customer.id, {
        connectionId: connectionA,
        query: "from:acme.com",
      }),
    ).toBeNull();
    await expect(
      listAvailableSources(b.organization.id, connectionA, "gmail"),
    ).rejects.toBeInstanceOf(IntegrationError);

    expect(await listCustomerSources(b.organization.id, b.customer.id)).toEqual(
      [],
    );
    expect(
      await listCustomerSources(a.organization.id, a.customer.id),
    ).toHaveLength(1);
  });

  it("refuses sources for an archived customer", async () => {
    const tenant = await createTenant("src-gone");
    const connection = await connect(tenant.organization.id, "sub-gone");
    await archiveCustomer(tenant.organization.id, tenant.customer.id);
    expect(
      await listCustomerSources(tenant.organization.id, tenant.customer.id),
    ).toBeNull();
    expect(
      await addCustomerSource(tenant.organization.id, tenant.customer.id, {
        connectionId: connection,
        kind: "gmail",
        sourceId: "L1",
      }),
    ).toBeNull();
  });
});

describe("token refresh", () => {
  it("refreshes expiring tokens and stores the result", async () => {
    const id = await connect(a.organization.id, "sub-refresh");
    await getControlPlaneDb()
      .update(integrationConnections)
      .set({ accessTokenExpiresAt: new Date(Date.now() + 5_000) })
      .where(eq(integrationConnections.id, id));

    const fresh = await getFreshIntegrationTokens(a.organization.id, id);
    expect(fresh?.tokens.accessToken).toBe("fake-access-1");
    expect(fresh?.tokens.refreshToken).toBe("fake-refresh");
    expect(await getIntegrationTokens(a.organization.id, id)).toMatchObject({
      accessToken: "fake-access-1",
      refreshToken: "fake-refresh",
    });
    // Now valid for an hour: no second refresh.
    const again = await getFreshIntegrationTokens(a.organization.id, id);
    expect(again?.tokens.accessToken).toBe("fake-access-1");
    expect(await getFreshIntegrationTokens(b.organization.id, id)).toBeNull();
  });

  it("marks the connection for reconnecting when the refresh is rejected", async () => {
    const connection = await saveIntegrationConnection({
      organizationId: a.organization.id,
      provider: "google",
      account: { externalAccountId: "sub-revoked", label: "revoked" },
      tokens: {
        accessToken: "old",
        refreshToken: "revoked-refresh",
        expiresAt: new Date(Date.now() - 1000),
        scopes: [],
      },
    });
    const adapter = useFakeGoogle();
    adapter.refreshTokens = async () => {
      throw new IntegrationError("invalid_grant", 400);
    };
    await expect(
      getFreshIntegrationTokens(a.organization.id, connection.id),
    ).rejects.toBeInstanceOf(IntegrationError);
    const [row] = await getControlPlaneDb()
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connection.id));
    expect(row.status).toBe("needs_reauth");
  });
});

describe("OAuth connect flow", () => {
  const user = (): { organizationId: string } => ({
    organizationId: a.organization.id,
  });

  it("starts with an unguessable state", () => {
    const first = startOAuth("google");
    const second = startOAuth("google");
    if (!first.ok || !second.ok) throw new Error("expected ok");
    expect(first.state).not.toBe(second.state);
    expect(first.state.length).toBeGreaterThanOrEqual(40);
    const url = new URL(first.authorizationUrl);
    expect(url.searchParams.get("state")).toBe(first.state);
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/google/callback",
    );
    expect(startOAuth("myspace")).toEqual({
      ok: false,
      error: "unknown_provider",
    });
    clearAdapters();
    vi.stubEnv("ATLASSIAN_CLIENT_ID", "");
    expect(startOAuth("atlassian")).toEqual({
      ok: false,
      error: "not_configured",
    });
  });

  it("rejects a callback whose state does not match", async () => {
    const before = await listIntegrationConnections(a.organization.id);
    for (const [expectedState, state] of [
      ["good", "evil"],
      [undefined, "good"],
      ["good", null],
    ] as const) {
      const query = new URLSearchParams({ code: "valid-code" });
      if (state) query.set("state", state);
      expect(
        await completeOAuth({
          provider: "google",
          user: user(),
          query,
          expectedState,
        }),
      ).toEqual({ ok: false, error: "state_mismatch" });
    }
    expect(await listIntegrationConnections(a.organization.id)).toHaveLength(
      before.length,
    );
  });

  it("handles refusal and a rejected code", async () => {
    expect(
      await completeOAuth({
        provider: "google",
        user: user(),
        query: new URLSearchParams({ state: "s", error: "access_denied" }),
        expectedState: "s",
      }),
    ).toEqual({ ok: false, error: "access_denied" });

    const adapter = useFakeGoogle();
    adapter.exchangeCodeForTokens = async () => {
      throw new IntegrationError("bad code", 400);
    };
    expect(
      await completeOAuth({
        provider: "google",
        user: user(),
        query: new URLSearchParams({ state: "s", code: "expired" }),
        expectedState: "s",
      }),
    ).toEqual({ ok: false, error: "exchange_failed" });
  });

  it("connects through the routes and stores encrypted tokens once", async () => {
    const { userId, headers } = await signUpUser("oauth");
    const [{ organizationId }] = await getControlPlaneDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId));
    const params = { params: Promise.resolve({ provider: "google" }) };
    const base = "http://localhost:3000/api/integrations/google";

    // Signed out: no redirect to the provider.
    const anonymous = await authorizeRoute(
      new Request(`${base}/authorize`),
      params,
    );
    expect(anonymous.headers.get("location")).toBe("/login");

    const start = await authorizeRoute(
      new Request(`${base}/authorize`, { headers }),
      params,
    );
    const authorizationUrl = new URL(start.headers.get("location")!);
    const state = authorizationUrl.searchParams.get("state")!;
    const stateCookie = start.headers.get("set-cookie")!;
    expect(authorizationUrl.host).toBe("fake-provider.test");
    expect(stateCookie).toContain(`robin_oauth_state=${state}`);
    expect(stateCookie).toMatch(/HttpOnly; SameSite=Lax/);

    const callback = async (cookieState: string): Promise<Response> => {
      const withState = new Headers(headers);
      withState.set(
        "cookie",
        `${headers.get("cookie")}; robin_oauth_state=${cookieState}`,
      );
      return callbackRoute(
        new Request(`${base}/callback?code=valid-code&state=${state}`, {
          headers: withState,
        }),
        params,
      );
    };

    const forged = await callback("someone-elses-state");
    expect(forged.headers.get("location")).toBe(
      "/integrations?error=state_mismatch",
    );
    expect(await listIntegrationConnections(organizationId)).toHaveLength(0);

    const done = await callback(state);
    expect(done.headers.get("location")).toBe("/integrations?connected=google");
    expect(done.headers.get("set-cookie")).toContain("Max-Age=0");

    // Connecting the same account again updates rather than duplicates.
    await callback(state);
    const connections = await listIntegrationConnections(organizationId);
    expect(connections).toHaveLength(1);
    expect(connections[0].accountLabel).toBe("fake@example.test");
    const [row] = await getControlPlaneDb()
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, connections[0].id));
    expect(row.encryptedAccessToken).toMatch(/^v1:/);
    expect(row.encryptedAccessToken).not.toContain("fake-access");
  });
});
