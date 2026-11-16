import { eq, sql } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import { memberships, organizations } from "@/db/control-plane/schema";

export interface OnboardingUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Returns the id of the user's organisation, creating a default one (with the
 * user as owner) if they have none. Idempotent and safe to call concurrently.
 *
 * v1 has no organisation management: every user has exactly one organisation,
 * created on first sign-in.
 */
export async function ensureDefaultOrganization(
  user: OnboardingUser,
): Promise<string> {
  return getControlPlaneDb().transaction(async (tx) => {
    // Serialise concurrent calls for the same user until the transaction ends.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);

    const [existing] = await tx
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .orderBy(memberships.createdAt)
      .limit(1);
    if (existing) return existing.organizationId;

    const label = user.name.trim() || user.email;
    const [organization] = await tx
      .insert(organizations)
      .values({ name: `${label}'s organisation` })
      .returning({ id: organizations.id });
    await tx.insert(memberships).values({
      userId: user.id,
      organizationId: organization.id,
      role: "owner",
    });
    return organization.id;
  });
}
