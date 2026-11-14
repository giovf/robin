import { notFound } from "next/navigation";

import type { Solution } from "@/db/customer/schema";

import { CustomerConnectionError } from "./customer-connection";
import { getCustomer, type CustomerSummary } from "./customers";
import { requireUser, type CurrentUser } from "./session";
import { getSolution } from "./solutions";

export interface CustomerContext {
  user: CurrentUser;
  customer: CustomerSummary;
}

/**
 * For pages under /customers/[customerId]: the signed-in user and the active
 * customer in the URL. Renders "not found" for customers that are missing,
 * archived or owned by another organisation — indistinguishably.
 */
export async function requireCustomer(
  customerId: string,
): Promise<CustomerContext> {
  const user = await requireUser();
  const customer = await getCustomer(user.organizationId, customerId);
  if (!customer || customer.status !== "active") notFound();
  return { user, customer };
}

/** Runs customer-scoped work, rendering "not found" if access is refused. */
export async function orNotFound<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CustomerConnectionError) notFound();
    throw error;
  }
}

export interface SolutionContext extends CustomerContext {
  solution: Solution;
}

/** For pages under …/solutions/[solutionId]. */
export async function requireSolution(
  customerId: string,
  solutionId: string,
): Promise<SolutionContext> {
  const context = await requireCustomer(customerId);
  const solution = await orNotFound(() =>
    getSolution(context.user.id, customerId, solutionId),
  );
  if (!solution) notFound();
  return { ...context, solution };
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { dateStyle: "medium" });
}
