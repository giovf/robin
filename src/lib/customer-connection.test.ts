import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { solutions } from "@/db/customer/schema";
import { createTenant, type Tenant } from "@/test/fixtures";

import {
  CustomerAccessDeniedError,
  CustomerArchivedError,
  CustomerConnectionError,
  CustomerNotFoundError,
  getCustomerConnection,
} from "./customer-connection";
import { archiveCustomerDatabase } from "./customer-provisioning";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await createTenant("alpha");
  b = await createTenant("beta");
});

afterAll(async () => {
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("getCustomerConnection", () => {
  it("gives a member a connection to their customer's own database", async () => {
    const db = await getCustomerConnection(a.user.id, a.customer.id);
    const result = await db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    expect(result.rows[0].name).toBe(a.customer.databaseName);
  });

  it("reuses one pool per customer", async () => {
    expect(await getCustomerConnection(a.user.id, a.customer.id)).toBe(
      await getCustomerConnection(a.user.id, a.customer.id),
    );
    expect(await getCustomerConnection(b.user.id, b.customer.id)).not.toBe(
      await getCustomerConnection(a.user.id, a.customer.id),
    );
  });

  it("denies a user from another organisation", async () => {
    await expect(
      getCustomerConnection(a.user.id, b.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    await expect(
      getCustomerConnection(b.user.id, a.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
  });

  it("denies unknown and malformed user ids", async () => {
    for (const userId of [crypto.randomUUID(), "", "' or 1=1 --"]) {
      await expect(
        getCustomerConnection(userId, a.customer.id),
      ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    }
  });

  it("reports unknown and malformed customer ids as not found", async () => {
    for (const customerId of [crypto.randomUUID(), "nope"]) {
      const error = await getCustomerConnection(a.user.id, customerId).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(CustomerNotFoundError);
      expect(error).toBeInstanceOf(CustomerConnectionError);
    }
  });

  it("keeps each customer's data in its own database", async () => {
    const dbA = await getCustomerConnection(a.user.id, a.customer.id);
    const dbB = await getCustomerConnection(b.user.id, b.customer.id);
    await dbA.insert(solutions).values({ name: "Alpha secret roadmap" });
    await dbB.insert(solutions).values({ name: "Beta migration" });

    const seenByA = await dbA.select({ name: solutions.name }).from(solutions);
    const seenByB = await dbB.select({ name: solutions.name }).from(solutions);
    expect(seenByA).toEqual([{ name: "Alpha secret roadmap" }]);
    expect(seenByB).toEqual([{ name: "Beta migration" }]);
  });

  it("refuses an archived customer, even to its owner", async () => {
    const gone = await createTenant("gamma");
    await getCustomerConnection(gone.user.id, gone.customer.id);
    await archiveCustomerDatabase(gone.customer.id);
    await expect(
      getCustomerConnection(gone.user.id, gone.customer.id),
    ).rejects.toBeInstanceOf(CustomerArchivedError);
  });
});
