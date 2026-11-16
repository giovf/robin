import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getAuth } from "./auth";
import { ensureDefaultOrganization } from "./onboarding";

/** The signed-in user, as much of it as the app needs. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  /** The user's organisation; every customer they can see belongs to it. */
  organizationId: string;
}

/** Resolves request headers to the signed-in user, or null. */
export async function getUserFromHeaders(
  requestHeaders: Headers,
): Promise<CurrentUser | null> {
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const { id, email, name } = session.user;
  // Also repairs a sign-up whose organisation creation failed half-way.
  const organizationId = await ensureDefaultOrganization({ id, email, name });
  return { id, email, name, organizationId };
}

/**
 * The signed-in user for the current request, or null. Reads cookies, so with
 * Cache Components the calling component must sit inside `<Suspense>`.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  return getUserFromHeaders(await headers());
});

/** Like getCurrentUser, but sends signed-out visitors to the login page. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
