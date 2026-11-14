import { and, asc, eq, sql } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import { customers, type Customer } from "@/db/control-plane/schema";
import { isUuid } from "@/db/customer/database-url";

import {
  archiveCustomerDatabase,
  createCustomer as provisionCustomer,
} from "./customer-provisioning";
import { requiredText } from "./validation";

export const CUSTOMER_NAME_MAX_LENGTH = 120;

/** What the hub shows about a customer; never the database name. */
export type CustomerSummary = Pick<
  Customer,
  "id" | "name" | "status" | "createdAt" | "updatedAt"
>;

const summary = {
  id: customers.id,
  name: customers.name,
  status: customers.status,
  createdAt: customers.createdAt,
  updatedAt: customers.updatedAt,
};

/** The organisation's customers (registry data only), by name. */
export async function listCustomers(
  organizationId: string,
): Promise<CustomerSummary[]> {
  return getControlPlaneDb()
    .select(summary)
    .from(customers)
    .where(eq(customers.organizationId, organizationId))
    .orderBy(asc(sql`lower(${customers.name})`));
}

/** One of the organisation's customers, or null if it is not theirs. */
export async function getCustomer(
  organizationId: string,
  customerId: string,
): Promise<CustomerSummary | null> {
  if (!isUuid(customerId)) return null;
  const [customer] = await getControlPlaneDb()
    .select(summary)
    .from(customers)
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, organizationId),
      ),
    )
    .limit(1);
  return customer ?? null;
}

/**
 * Creates a customer for the organisation and provisions its database.
 * @throws ValidationError
 */
export async function createCustomer(
  organizationId: string,
  input: { name: unknown },
): Promise<CustomerSummary> {
  const name = requiredText(input.name, "Name", CUSTOMER_NAME_MAX_LENGTH);
  const { id, status, createdAt, updatedAt } = await provisionCustomer({
    organizationId,
    name,
  });
  return { id, name, status, createdAt, updatedAt };
}

/**
 * Renames one of the organisation's customers. Returns false if the customer
 * is not theirs.
 * @throws ValidationError
 */
export async function renameCustomer(
  organizationId: string,
  customerId: string,
  input: { name: unknown },
): Promise<boolean> {
  const name = requiredText(input.name, "Name", CUSTOMER_NAME_MAX_LENGTH);
  if (!isUuid(customerId)) return false;
  const updated = await getControlPlaneDb()
    .update(customers)
    .set({ name })
    .where(
      and(
        eq(customers.id, customerId),
        eq(customers.organizationId, organizationId),
      ),
    )
    .returning({ id: customers.id });
  return updated.length > 0;
}

/**
 * Archives one of the organisation's customers: access is refused from now
 * on and its database is set aside (content kept). Returns false if the
 * customer is not theirs.
 */
export async function archiveCustomer(
  organizationId: string,
  customerId: string,
): Promise<boolean> {
  const customer = await getCustomer(organizationId, customerId);
  if (!customer) return false;
  await archiveCustomerDatabase(customer.id);
  return true;
}
