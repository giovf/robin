import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  closeControlPlaneDb,
  getControlPlaneDb,
  verifyControlPlaneConnection,
} from "./connection";
import { memberships, organizations, users } from "./schema";

afterAll(closeControlPlaneDb);

describe("control-plane connection", () => {
  it("connects to the test control plane, never the dev database", async () => {
    await verifyControlPlaneConnection();
    const result = await getControlPlaneDb().execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    expect(result.rows[0].name).toBe("robin_test");
  });

  it("returns the same client every time", () => {
    expect(getControlPlaneDb()).toBe(getControlPlaneDb());
  });
});

describe("control-plane schema", () => {
  it("rejects a duplicate email", async () => {
    const db = getControlPlaneDb();
    const email = `dup-${crypto.randomUUID()}@example.test`;
    await db.insert(users).values({ email });
    await expect(db.insert(users).values({ email })).rejects.toThrow();
  });

  it("allows only one membership per user and organisation", async () => {
    const db = getControlPlaneDb();
    const [user] = await db
      .insert(users)
      .values({ email: `m-${crypto.randomUUID()}@example.test` })
      .returning();
    const [org] = await db
      .insert(organizations)
      .values({ name: "Org" })
      .returning();
    const membership = { userId: user.id, organizationId: org.id };
    const [created] = await db
      .insert(memberships)
      .values(membership)
      .returning();
    expect(created.role).toBe("owner");
    await expect(db.insert(memberships).values(membership)).rejects.toThrow();
  });
});
