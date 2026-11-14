import { getControlPlaneDb } from "@/db/control-plane/connection";
import {
  memberships,
  organizations,
  users,
  type Customer,
  type Organization,
  type User,
} from "@/db/control-plane/schema";
import { createCustomer } from "@/lib/customer-provisioning";

export interface Tenant {
  user: User;
  organization: Organization;
  customer: Customer;
}

/** A user with their own organisation and one provisioned customer. */
export async function createTenant(label: string): Promise<Tenant> {
  const db = getControlPlaneDb();
  const unique = crypto.randomUUID();
  const [user] = await db
    .insert(users)
    .values({ email: `${label}-${unique}@example.test` })
    .returning();
  const [organization] = await db
    .insert(organizations)
    .values({ name: `${label} org` })
    .returning();
  await db
    .insert(memberships)
    .values({ userId: user.id, organizationId: organization.id });
  const customer = await createCustomer({
    organizationId: organization.id,
    name: `${label} customer`,
  });
  return { user, organization, customer };
}
