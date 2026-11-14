import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeControlPlaneDb } from "@/db/control-plane/connection";
import { closeAllCustomerPools } from "@/db/customer/pools";
import { createTenant, type Tenant } from "@/test/fixtures";

import {
  CustomerAccessDeniedError,
  CustomerArchivedError,
  getCustomerConnection,
} from "./customer-connection";
import {
  archiveCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  renameCustomer,
} from "./customers";
import {
  createSolution,
  getSolution,
  listSolutions,
  setSolutionPhase,
  setSolutionStatus,
  updateSolution,
} from "./solutions";
import { ValidationError } from "./validation";

let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  a = await createTenant("cust-a");
  b = await createTenant("cust-b");
});

afterAll(async () => {
  await closeAllCustomerPools();
  await closeControlPlaneDb();
});

describe("customers", () => {
  it("creates a customer with a working database", async () => {
    const customer = await createCustomer(a.organization.id, {
      name: "  Globex  ",
    });
    expect(customer.name).toBe("Globex");
    expect("databaseName" in customer).toBe(false);
    await getCustomerConnection(a.user.id, customer.id);
  });

  it("validates the name", async () => {
    await expect(
      createCustomer(a.organization.id, { name: "   " }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCustomer(a.organization.id, { name: "x".repeat(121) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists only the organisation's own customers", async () => {
    const namesA = (await listCustomers(a.organization.id)).map((c) => c.name);
    const namesB = (await listCustomers(b.organization.id)).map((c) => c.name);
    expect(namesA).toEqual(["cust-a customer", "Globex"]);
    expect(namesB).toEqual(["cust-b customer"]);
  });

  it("does not show or rename another organisation's customer", async () => {
    expect(await getCustomer(b.organization.id, a.customer.id)).toBeNull();
    expect(
      await renameCustomer(b.organization.id, a.customer.id, { name: "Mine" }),
    ).toBe(false);
    expect((await getCustomer(a.organization.id, a.customer.id))?.name).toBe(
      "cust-a customer",
    );
    expect(await getCustomer(a.organization.id, "not-a-uuid")).toBeNull();
  });

  it("renames a customer", async () => {
    expect(
      await renameCustomer(a.organization.id, a.customer.id, { name: "Acme" }),
    ).toBe(true);
    expect((await getCustomer(a.organization.id, a.customer.id))?.name).toBe(
      "Acme",
    );
  });

  it("archives only its own customers, and then refuses access", async () => {
    const doomed = await createCustomer(a.organization.id, { name: "Old" });
    expect(await archiveCustomer(b.organization.id, doomed.id)).toBe(false);
    await getCustomerConnection(a.user.id, doomed.id);

    expect(await archiveCustomer(a.organization.id, doomed.id)).toBe(true);
    expect((await getCustomer(a.organization.id, doomed.id))?.status).toBe(
      "archived",
    );
    await expect(
      getCustomerConnection(a.user.id, doomed.id),
    ).rejects.toBeInstanceOf(CustomerArchivedError);
  });
});

describe("solutions", () => {
  it("creates, edits, moves and archives a solution", async () => {
    const created = await createSolution(a.user.id, a.customer.id, {
      name: "Data platform",
      description: "",
    });
    expect(created).toMatchObject({
      name: "Data platform",
      description: null,
      currentPhase: "discovery",
      status: "active",
    });

    const edited = await updateSolution(a.user.id, a.customer.id, created.id, {
      name: "Data platform v2",
      description: "Lakehouse",
    });
    expect(edited?.description).toBe("Lakehouse");
    expect(edited!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      created.updatedAt.getTime(),
    );

    const moved = await setSolutionPhase(
      a.user.id,
      a.customer.id,
      created.id,
      "design",
    );
    expect(moved?.currentPhase).toBe("design");
    await expect(
      setSolutionPhase(a.user.id, a.customer.id, created.id, "made-up"),
    ).rejects.toBeInstanceOf(ValidationError);

    await setSolutionStatus(a.user.id, a.customer.id, created.id, "archived");
    expect(await listSolutions(a.user.id, a.customer.id)).toHaveLength(0);
    expect(
      await listSolutions(a.user.id, a.customer.id, { includeArchived: true }),
    ).toHaveLength(1);
  });

  it("validates input and unknown ids", async () => {
    await expect(
      createSolution(a.user.id, a.customer.id, { name: "" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await getSolution(a.user.id, a.customer.id, "nope")).toBeNull();
    expect(
      await updateSolution(a.user.id, a.customer.id, crypto.randomUUID(), {
        name: "Ghost",
      }),
    ).toBeNull();
  });

  it("keeps solutions isolated per customer", async () => {
    const secret = await createSolution(b.user.id, b.customer.id, {
      name: "Beta secret",
    });

    // A's user cannot reach B's customer at all…
    await expect(
      listSolutions(a.user.id, b.customer.id),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    await expect(
      createSolution(a.user.id, b.customer.id, { name: "Intruder" }),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);
    await expect(
      setSolutionStatus(a.user.id, b.customer.id, secret.id, "archived"),
    ).rejects.toBeInstanceOf(CustomerAccessDeniedError);

    // …and B's solution id means nothing inside A's own customer.
    expect(await getSolution(a.user.id, a.customer.id, secret.id)).toBeNull();
    expect(
      await updateSolution(a.user.id, a.customer.id, secret.id, {
        name: "Hijacked",
      }),
    ).toBeNull();
    expect((await getSolution(b.user.id, b.customer.id, secret.id))?.name).toBe(
      "Beta secret",
    );
  });
});
