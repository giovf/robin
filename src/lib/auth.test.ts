import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  closeControlPlaneDb,
  getControlPlaneDb,
} from "@/db/control-plane/connection";
import {
  accounts,
  memberships,
  organizations,
  users,
} from "@/db/control-plane/schema";

import { getAuth, isSignUpOpen } from "./auth";
import { ensureDefaultOrganization } from "./onboarding";
import { getUserFromHeaders } from "./session";

const PASSWORD = "correct horse battery staple";

function sessionHeaders(response: Headers): Headers {
  const cookie = response
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

beforeAll(async () => {
  // Start from "no users yet". Test database only (see vitest.config.mts).
  await getControlPlaneDb().execute(sql`truncate table users cascade`);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeControlPlaneDb();
});

describe("authentication", () => {
  let firstUserId: string;
  let firstUserHeaders: Headers;

  it("signs up the first user and creates their organisation", async () => {
    expect(await isSignUpOpen()).toBe(true);
    const { headers, response } = await getAuth().api.signUpEmail({
      body: { email: "Ada@Example.test", password: PASSWORD, name: "Ada" },
      returnHeaders: true,
    });
    firstUserId = response.user.id;
    firstUserHeaders = sessionHeaders(headers);

    const db = getControlPlaneDb();
    const [user] = await db.select().from(users);
    expect(user.email).toBe("ada@example.test");
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, firstUserId));
    expect(membership.role).toBe("owner");
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, membership.organizationId));
    expect(organization.name).toBe("Ada's organisation");
  });

  it("stores a password hash, never the password", async () => {
    const [account] = await getControlPlaneDb()
      .select()
      .from(accounts)
      .where(eq(accounts.userId, firstUserId));
    expect(account.providerId).toBe("credential");
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
  });

  it("resolves a session cookie to the user and organisation", async () => {
    const user = await getUserFromHeaders(firstUserHeaders);
    expect(user).toMatchObject({ id: firstUserId, name: "Ada" });
    const [membership] = await getControlPlaneDb()
      .select()
      .from(memberships)
      .where(eq(memberships.userId, firstUserId));
    expect(user?.organizationId).toBe(membership.organizationId);
  });

  it("treats a missing or forged cookie as signed out", async () => {
    expect(await getUserFromHeaders(new Headers())).toBeNull();
    const forged = new Headers({
      cookie: "better-auth.session_token=forged.signature",
    });
    expect(await getUserFromHeaders(forged)).toBeNull();
  });

  it("signs in with the right password only", async () => {
    const { headers } = await getAuth().api.signInEmail({
      body: { email: "ada@example.test", password: PASSWORD },
      returnHeaders: true,
    });
    expect(await getUserFromHeaders(sessionHeaders(headers))).not.toBeNull();
    await expect(
      getAuth().api.signInEmail({
        body: { email: "ada@example.test", password: "wrong password 123" },
      }),
    ).rejects.toThrow();
  });

  it("rejects short passwords", async () => {
    vi.stubEnv("ALLOW_SIGNUP", "true");
    await expect(
      getAuth().api.signUpEmail({
        body: { email: "short@example.test", password: "short", name: "S" },
      }),
    ).rejects.toThrow();
    vi.unstubAllEnvs();
  });

  it("closes sign-up once a user exists, unless ALLOW_SIGNUP=true", async () => {
    expect(await isSignUpOpen()).toBe(false);
    const second = {
      body: { email: "bob@example.test", password: PASSWORD, name: "Bob" },
    };
    await expect(getAuth().api.signUpEmail(second)).rejects.toThrow();
    expect(await getControlPlaneDb().select().from(users)).toHaveLength(1);

    vi.stubEnv("ALLOW_SIGNUP", "true");
    await getAuth().api.signUpEmail(second);
    expect(await getControlPlaneDb().select().from(users)).toHaveLength(2);
  });

  it("signs out by invalidating the session", async () => {
    await getAuth().api.signOut({ headers: firstUserHeaders });
    expect(await getUserFromHeaders(firstUserHeaders)).toBeNull();
  });

  it("creates the default organisation only once", async () => {
    const user = { id: firstUserId, name: "Ada", email: "ada@example.test" };
    const ids = await Promise.all([
      ensureDefaultOrganization(user),
      ensureDefaultOrganization(user),
      ensureDefaultOrganization(user),
    ]);
    expect(new Set(ids).size).toBe(1);
    expect(
      await getControlPlaneDb()
        .select()
        .from(memberships)
        .where(eq(memberships.userId, firstUserId)),
    ).toHaveLength(1);
  });
});
