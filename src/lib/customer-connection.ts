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

export type { CustomerDb };

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

  return getCustomerDb(row.databaseName);
}
