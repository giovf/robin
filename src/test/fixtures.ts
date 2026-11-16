import { getControlPlaneDb } from "@/db/control-plane/connection";
import {
  memberships,
  organizations,
  users,
  type Customer,
  type Organization,
  type User,
} from "@/db/control-plane/schema";
import { getAuth } from "@/lib/auth";
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

/**
 * Signs up a real user through the auth library and returns request headers
 * carrying their session cookie. The caller must have ALLOW_SIGNUP=true.
 */
export async function signUpUser(
  label: string,
): Promise<{ userId: string; headers: Headers }> {
  const { headers, response } = await getAuth().api.signUpEmail({
    body: {
      name: label,
      email: `${label}-${crypto.randomUUID()}@example.test`,
      password: "correct horse battery staple",
    },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { userId: response.user.id, headers: new Headers({ cookie }) };
}
