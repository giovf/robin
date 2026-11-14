/**
 * Customer isolation — the hard rule. Two organisations, each with its own
 * user and customer; nothing of one may ever be reachable from the other.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { GET as exportRoute } from "@/app/api/customers/[customerId]/export/route";
import {
  closeControlPlaneDb,
  getControlPlaneDb,
} from "@/db/control-plane/connection";
import { memberships } from "@/db/control-plane/schema";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { solutions, sourceItems } from "@/db/customer/schema";
import {
  CustomerAccessDeniedError,
  CustomerArchivedError,
  getCustomerConnection,
} from "@/lib/customer-connection";
import { exportCustomerData } from "@/lib/customer-export";
import {
  archiveCustomer,
  createCustomer,
  deleteCustomer,
  getCustomer,
  restoreCustomer,
  type CustomerSummary,
} from "@/lib/customers";
import { ValidationError } from "@/lib/validation";

import { signUpUser } from "./fixtures";

interface Party {
  userId: string;
  organizationId: string;
  headers: Headers;
  customer: CustomerSummary;
}

async function createParty(label: string): Promise<Party> {
  const { userId, headers } = await signUpUser(label);
  const [membership] = await getControlPlaneDb()
    .select()
    .from(memberships)
    .where(eq(memberships.userId, userId));
  const organizationId = membership.organizationId;
  const customer = await createCustomer(organizationId, {
    name: `${label} customer`,
  });
  const db = await getCustomerConnection(userId, customer.id);
  await db.insert(solutions).values({ name: `${label} solution` });
  await db
    .insert(sourceItems)
    .values({ provider: "upload", title: `${label} confidential notes` });
  return { userId, organizationId, headers, customer };
}

function callExport(headers: Headers, customerId: string): Promise<Response> {
  return exportRoute(
    new Request(`http://localhost/api/customers/${customerId}/export`, {
      headers,
    }),
    { params: Promise.resolve({ customerId }) },
  );
}

let a: Party;
let b: Party;

beforeAll(async () => {
  vi.stubEnv("ALLOW_SIGNUP", "true");
  a = await createParty("iso-a");
  b = await createParty("iso-b");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("resolver", () => {
  it("denies each user the other's customer", async () => {
    await expect(
      getCustomerConnection(a.userId, b.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    await expect(
      getCustomerConnection(b.userId, a.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
  });

  it("returns only the customer's own rows", async () => {
    const dbA = await getCustomerConnection(a.userId, a.customer.id);
    const dbB = await getCustomerConnection(b.userId, b.customer.id);
    expect(await dbA.select({ name: solutions.name }).from(solutions)).toEqual([
      { name: "iso-a solution" },
    ]);
    expect(await dbB.select({ name: solutions.name }).from(solutions)).toEqual([
      { name: "iso-b solution" },
    ]);
  });
});

describe("database level", () => {
  it("gives every customer a separate database", async () => {
    const name = async (party: Party): Promise<unknown> => {
      const db = await getCustomerConnection(party.userId, party.customer.id);
      const result = await db.execute(sql`select current_database() as name`);
      return result.rows[0].name;
    };
    const [nameA, nameB] = [await name(a), await name(b)];
    expect(nameA).not.toBe(nameB);
    expect(nameA).not.toBe("robin_test");
  });

  it("cannot reach another customer's tables even with raw SQL", async () => {
    const dbA = await getCustomerConnection(a.userId, a.customer.id);
    const dbB = await getCustomerConnection(b.userId, b.customer.id);
    const other = (await dbB.execute(sql`select current_database() as name`))
      .rows[0].name as string;
    await expect(
      dbA.execute(sql.raw(`select * from "${other}".public.solutions`)),
    ).rejects.toThrow();
  });

  it("keeps customer content out of the control plane, and vice versa", async () => {
    const tables = async (db: {
      execute: typeof dbA.execute;
    }): Promise<string[]> => {
      const result = await db.execute<{ table_name: string }>(
        sql`select table_name from information_schema.tables where table_schema = 'public'`,
      );
      return result.rows.map((row) => row.table_name);
    };
    const dbA = await getCustomerConnection(a.userId, a.customer.id);
    const controlPlane = await tables(getControlPlaneDb());
    const customer = await tables(dbA);

    expect(controlPlane).toContain("customers");
    expect(customer).toContain("solutions");
    expect(controlPlane.filter((name) => customer.includes(name))).toEqual([]);
    for (const name of ["users", "sessions", "integration_connections"]) {
      expect(customer).not.toContain(name);
    }
  });
});

describe("services and routes", () => {
  it("hides the other organisation's customer from lookups", async () => {
    expect(await getCustomer(a.organizationId, b.customer.id)).toBeNull();
    expect(await archiveCustomer(a.organizationId, b.customer.id)).toBe(false);
    expect(await restoreCustomer(a.organizationId, b.customer.id)).toBe(false);
    expect(
      await deleteCustomer(a.organizationId, b.customer.id, b.customer.name),
    ).toBe(false);
    // …and B's customer is untouched.
    await getCustomerConnection(b.userId, b.customer.id);
  });

  it("exports only the customer's own data", async () => {
    const data = await exportCustomerData(
      { id: a.userId, organizationId: a.organizationId },
      a.customer.id,
    );
    const text = JSON.stringify(data);
    expect(text).toContain("iso-a solution");
    expect(text).toContain("iso-a confidential notes");
    expect(text).not.toContain("iso-b");
    expect(text).not.toContain("customer_"); // no database names
    await expect(
      exportCustomerData(
        { id: a.userId, organizationId: a.organizationId },
        b.customer.id,
      ),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
  });

  it("guards the export endpoint", async () => {
    const own = await callExport(a.headers, a.customer.id);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toMatch(
      /attachment; filename="robin-export-iso-a-customer-/,
    );
    expect(await own.text()).toContain("iso-a solution");

    const foreign = await callExport(a.headers, b.customer.id);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).not.toContain("iso-b");

    expect((await callExport(new Headers(), a.customer.id)).status).toBe(401);
    expect((await callExport(a.headers, "not-a-uuid")).status).toBe(404);
  });
});

describe("archive, restore and delete", () => {
  it("blocks an archived customer and brings it back intact", async () => {
    await archiveCustomer(a.organizationId, a.customer.id);
    await expect(
      getCustomerConnection(a.userId, a.customer.id),
    ).rejects.toBeInstanceOf(CustomerArchivedError);
    expect((await callExport(a.headers, a.customer.id)).status).toBe(404);

    await restoreCustomer(a.organizationId, a.customer.id);
    const db = await getCustomerConnection(a.userId, a.customer.id);
    expect(await db.select({ name: solutions.name }).from(solutions)).toEqual([
      { name: "iso-a solution" },
    ]);
  });

  it("deletes one customer completely without touching the other", async () => {
    await expect(
      deleteCustomer(a.organizationId, a.customer.id, "wrong name"),
    ).rejects.toBeInstanceOf(ValidationError);
    await getCustomerConnection(a.userId, a.customer.id);

    expect(
      await deleteCustomer(a.organizationId, a.customer.id, a.customer.name),
    ).toBe(true);
    expect(await getCustomer(a.organizationId, a.customer.id)).toBeNull();
    const left = await getControlPlaneDb().execute(
      sql`select 1 from pg_database where datname like ${"%" + a.customer.id.replaceAll("-", "_")}`,
    );
    expect(left.rows).toHaveLength(0);

    const dbB = await getCustomerConnection(b.userId, b.customer.id);
    expect(await dbB.select({ name: solutions.name }).from(solutions)).toEqual([
      { name: "iso-b solution" },
    ]);
  });
});

describe("code structure", () => {
  const SRC = path.join(process.cwd(), "src");
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => file.split(path.sep).join("/"));
  const read = (file: string): string =>
    readFileSync(path.join(SRC, file), "utf8");

  it("lets only the resolver and provisioning touch customer pools", () => {
    const importers = files.filter((file) =>
      /from\s+["'](@\/db\/customer\/pools|\.{1,2}\/(.*\/)?pools)["']/.test(
        read(file),
      ),
    );
    expect(importers.sort()).toEqual([
      "lib/customer-connection.ts",
      "lib/customer-provisioning.ts",
    ]);
  });

  it("creates database pools in exactly two places", () => {
    const creators = files.filter(
      (file) =>
        !file.startsWith("test/") &&
        /new\s+(Pool|Client)\s*\(/.test(read(file)),
    );
    expect(creators.sort()).toEqual([
      "db/control-plane/connection.ts",
      "db/customer/pools.ts",
    ]);
  });
});
