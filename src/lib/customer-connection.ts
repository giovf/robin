/**
 * The customer-connection resolver: the ONLY way customer-scoped code gets a
 * database connection. It checks that the user's organisation owns the
 * customer before handing out a client bound to that customer's database.
 */
import { and, eq } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import { customers, memberships } from "@/db/control-plane/schema";
import { isUuid } from "@/db/customer/database-url";
import { getCustomerDb, type CustomerDb } from "@/db/customer/pools";
import { calls } from "@/db/customer/schema";

import { migrateCustomerDatabase } from "./customer-provisioning";

export type { CustomerDb };

const globalForMigrations = globalThis as typeof globalThis & {
  __robinCustomerMigrations?: Map<string, Promise<void>>;
};

/**
 * Brings a customer database up to the current schema the first time this
 * process touches it, so an app upgrade needs no separate migration step.
 */
function ensureMigrated(databaseName: string): Promise<void> {
  globalForMigrations.__robinCustomerMigrations ??= new Map();
  const done = globalForMigrations.__robinCustomerMigrations;
  let pending = done.get(databaseName);
  if (!pending) {
    pending = migrateCustomerDatabase(databaseName);
    done.set(databaseName, pending);
    // Try again next time if it failed.
    pending.catch(() => done.delete(databaseName));
  }
  return pending;
}

/** Base class, so callers can catch every resolver refusal at once. */
export class CustomerConnectionError extends Error {
  constructor(
    message: string,
    public readonly customerId: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class CustomerNotFoundError extends CustomerConnectionError {
  constructor(customerId: string) {
    super(`Customer ${customerId} does not exist.`, customerId);
  }
}

/**
 * The user is not a member of the organisation that owns the customer.
 * API handlers should answer this like "not found", so the existence of
 * other organisations' customers is not revealed.
 */
export class CustomerAccessDeniedError extends CustomerConnectionError {
  constructor(customerId: string) {
    super(`Access to customer ${customerId} denied.`, customerId);
  }
}

export class CustomerArchivedError extends CustomerConnectionError {
  constructor(customerId: string) {
    super(`Customer ${customerId} is archived.`, customerId);
  }
}

/**
 * Resolves a user + customer to a client for that customer's database.
 * Call it per request; do not cache the result across requests.
 *
 * @throws CustomerNotFoundError, CustomerAccessDeniedError, CustomerArchivedError
 */
export async function getCustomerConnection(
  userId: string,
  customerId: string,
): Promise<CustomerDb> {
  if (!isUuid(customerId)) throw new CustomerNotFoundError(customerId);
  // A malformed user id cannot be a member of anything.
  if (!isUuid(userId)) throw new CustomerAccessDeniedError(customerId);

  const [row] = await getControlPlaneDb()
    .select({
      status: customers.status,
      databaseName: customers.databaseName,
      membershipId: memberships.id,
    })
    .from(customers)
    .leftJoin(
      memberships,
      and(
        eq(memberships.organizationId, customers.organizationId),
        eq(memberships.userId, userId),
      ),
    )
    .where(eq(customers.id, customerId))
    .limit(1);

  if (!row) throw new CustomerNotFoundError(customerId);
  if (!row.membershipId) throw new CustomerAccessDeniedError(customerId);
  if (row.status !== "active") throw new CustomerArchivedError(customerId);

  await ensureMigrated(row.databaseName);
  return getCustomerDb(row.databaseName);
}

/**
 * For meeting-bot webhooks, which arrive without a signed-in user: resolves a
 * customer's database from the (customer id, bot id) pair the provider echoes
 * back, and returns it only if that bot really belongs to a call in that
 * database. Call this only after verifying the webhook's signature.
 *
 * The ownership check here is "this bot was started for this customer"
 * instead of "this user's organisation owns this customer".
 *
 * @throws CustomerNotFoundError, CustomerArchivedError
 */
export async function getCustomerConnectionForBot(
  customerId: string,
  botId: string,
): Promise<{ db: CustomerDb; callId: string }> {
  if (!isUuid(customerId) || !botId)
    throw new CustomerNotFoundError(customerId);
  const [customer] = await getControlPlaneDb()
    .select({ status: customers.status, databaseName: customers.databaseName })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) throw new CustomerNotFoundError(customerId);
  if (customer.status !== "active") throw new CustomerArchivedError(customerId);

  await ensureMigrated(customer.databaseName);
  const db = getCustomerDb(customer.databaseName);
  const [call] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(eq(calls.botId, botId))
    .limit(1);
  // Same error as an unknown customer: reveal nothing to a forged request.
  if (!call) throw new CustomerNotFoundError(customerId);
  return { db, callId: call.id };
}
