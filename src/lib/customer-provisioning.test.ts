import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  closeControlPlaneDb,
  getControlPlaneDb,
} from "@/db/control-plane/connection";
import { customers, organizations } from "@/db/control-plane/schema";
import { customerDatabaseName } from "@/db/customer/database-url";
import { closeAllCustomerPools, getCustomerDb } from "@/db/customer/pools";
import {
  agentConfig,
  chunks,
  EMBEDDING_DIMENSIONS,
  sourceItems,
} from "@/db/customer/schema";

import {
  archiveCustomerDatabase,
  createCustomer,
  dropCustomerDatabase,
  provisionCustomerDatabase,
} from "./customer-provisioning";

async function databaseExists(name: string): Promise<boolean> {
  const result = await getControlPlaneDb().execute(
    sql`select 1 from pg_database where datname = ${name}`,
  );
  return result.rows.length > 0;
}

async function createOrganization(): Promise<string> {
  const [org] = await getControlPlaneDb()
    .insert(organizations)
    .values({ name: "Provisioning org" })
    .returning();
  return org.id;
}

afterAll(async () => {
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("customerDatabaseName", () => {
  it("derives the name from the customer id", () => {
    expect(customerDatabaseName("0F8FAD5B-d9cb-469f-a165-70867728950e")).toBe(
      "customer_0f8fad5b_d9cb_469f_a165_70867728950e",
    );
  });

  it("rejects anything that is not a uuid", () => {
    expect(() => customerDatabaseName('x"; drop database robin; --')).toThrow();
  });
});

describe("customer provisioning", () => {
  it("creates a migrated database and registers the customer", async () => {
    const customer = await createCustomer({
      organizationId: await createOrganization(),
      name: "Acme",
    });
    expect(customer.databaseName).toBe(customerDatabaseName(customer.id));
    expect(customer.status).toBe("active");
    expect(await databaseExists(customer.databaseName)).toBe(true);

    const tables = await getCustomerDb(customer.databaseName).execute<{
      table_name: string;
    }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "agent_config",
      "agent_memory",
      "calls",
      "chunks",
      "diagrams",
      "document_versions",
      "documents",
      "solutions",
      "source_items",
      "suggestions",
      "transcript_segments",
    ]);
  });

  it("is idempotent", async () => {
    const id = crypto.randomUUID();
    const organizationId = await createOrganization();
    const first = await provisionCustomerDatabase(id);
    const second = await provisionCustomerDatabase(id);
    expect(second).toBe(first);
    // Register it so global teardown can find it; then drop it.
    await getControlPlaneDb()
      .insert(customers)
      .values({ id, organizationId, name: "Twice", databaseName: first });
    await dropCustomerDatabase(id, first);
    expect(await databaseExists(first)).toBe(false);
  });

  it("stores and searches embeddings, and enforces schema constraints", async () => {
    const customer = await createCustomer({
      organizationId: await createOrganization(),
      name: "Vectors",
    });
    const db = getCustomerDb(customer.databaseName);
    const [item] = await db
      .insert(sourceItems)
      .values({ provider: "upload", title: "Notes" })
      .returning();
    const unit = (hot: number): number[] =>
      Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
        i === hot ? 1 : 0,
      );
    await db.insert(chunks).values([
      { sourceItemId: item.id, chunkIndex: 0, text: "a", embedding: unit(0) },
      { sourceItemId: item.id, chunkIndex: 1, text: "b", embedding: unit(1) },
    ]);
    const nearest = await db
      .select({ text: chunks.text })
      .from(chunks)
      .orderBy(sql`${chunks.embedding} <=> ${JSON.stringify(unit(1))}::vector`)
      .limit(1);
    expect(nearest[0].text).toBe("b");

    // A chunk needs exactly one origin.
    await expect(
      db.insert(chunks).values({ chunkIndex: 0, text: "orphan" }),
    ).rejects.toThrow();
    // agent_config is a singleton.
    await db.insert(agentConfig).values({});
    await expect(db.insert(agentConfig).values({ id: 2 })).rejects.toThrow();
  });

  it("drops the new database when the registry insert fails", async () => {
    const before = await getControlPlaneDb().execute(
      sql`select count(*)::int as n from pg_database where datname like 'customer\_%'`,
    );
    await expect(
      createCustomer({ organizationId: crypto.randomUUID(), name: "No org" }),
    ).rejects.toThrow();
    const after = await getControlPlaneDb().execute(
      sql`select count(*)::int as n from pg_database where datname like 'customer\_%'`,
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("archives by renaming, then drops only with matching confirmation", async () => {
    const customer = await createCustomer({
      organizationId: await createOrganization(),
      name: "Leaving",
    });
    const name = customer.databaseName;
    // Leave a pooled connection open: archiving must cope with it.
    await getCustomerDb(name).execute(sql`select 1`);

    await archiveCustomerDatabase(customer.id);
    await archiveCustomerDatabase(customer.id); // idempotent
    expect(await databaseExists(name)).toBe(false);
    expect(await databaseExists(`archived_${name}`)).toBe(true);
    const [row] = await getControlPlaneDb()
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    expect(row.status).toBe("archived");

    await expect(
      dropCustomerDatabase(customer.id, "customer_wrong"),
    ).rejects.toThrow(/Refusing to drop/);
    expect(await databaseExists(`archived_${name}`)).toBe(true);

    await dropCustomerDatabase(customer.id, name);
    expect(await databaseExists(`archived_${name}`)).toBe(false);
    expect(
      await getControlPlaneDb()
        .select()
        .from(customers)
        .where(eq(customers.id, customer.id)),
    ).toHaveLength(0);
  });
});
