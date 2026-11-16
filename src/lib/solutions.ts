import { asc, eq, ne, sql } from "drizzle-orm";

import { isUuid } from "@/db/customer/database-url";
import {
  SOLUTION_STATUSES,
  solutions,
  type Solution,
  type SolutionStatus,
} from "@/db/customer/schema";

import { getCustomerConnection } from "./customer-connection";
import { isGoingAheadPhase, isSolutionPhase } from "./phases";
import { optionalText, requiredText, ValidationError } from "./validation";

export const SOLUTION_NAME_MAX_LENGTH = 120;
export const SOLUTION_DESCRIPTION_MAX_LENGTH = 2000;

export interface SolutionInput {
  name: unknown;
  description?: unknown;
}

function parseInput(input: SolutionInput): {
  name: string;
  description: string | null;
} {
  return {
    name: requiredText(input.name, "Name", SOLUTION_NAME_MAX_LENGTH),
    description: optionalText(
      input.description,
      "Description",
      SOLUTION_DESCRIPTION_MAX_LENGTH,
    ),
  };
}

/*
 * Every function takes the acting user and the customer, and goes through the
 * customer-connection resolver — which throws a CustomerConnectionError when
 * the user may not access that customer.
 */

export async function listSolutions(
  userId: string,
  customerId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Solution[]> {
  const db = await getCustomerConnection(userId, customerId);
  return db
    .select()
    .from(solutions)
    .where(
      options.includeArchived ? undefined : ne(solutions.status, "archived"),
    )
    .orderBy(asc(sql`lower(${solutions.name})`));
}

export async function getSolution(
  userId: string,
  customerId: string,
  solutionId: string,
): Promise<Solution | null> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(solutionId)) return null;
  const [solution] = await db
    .select()
    .from(solutions)
    .where(eq(solutions.id, solutionId))
    .limit(1);
  return solution ?? null;
}

/** @throws ValidationError */
export async function createSolution(
  userId: string,
  customerId: string,
  input: SolutionInput,
): Promise<Solution> {
  const values = parseInput(input);
  const db = await getCustomerConnection(userId, customerId);
  const [solution] = await db.insert(solutions).values(values).returning();
  return solution;
}

async function update(
  userId: string,
  customerId: string,
  solutionId: string,
  values: Partial<
    Pick<Solution, "name" | "description" | "currentPhase" | "status">
  >,
): Promise<Solution | null> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(solutionId)) return null;
  const [solution] = await db
    .update(solutions)
    .set(values)
    .where(eq(solutions.id, solutionId))
    .returning();
  return solution ?? null;
}

/** Returns null if the solution does not exist. @throws ValidationError */
export async function updateSolution(
  userId: string,
  customerId: string,
  solutionId: string,
  input: SolutionInput,
): Promise<Solution | null> {
  return update(userId, customerId, solutionId, parseInput(input));
}

/**
 * Moves a solution to a phase. Moving an exploring solution into Delivery or
 * later also marks it as going ahead. Returns null if the solution does not
 * exist. @throws ValidationError
 */
export async function setSolutionPhase(
  userId: string,
  customerId: string,
  solutionId: string,
  phase: unknown,
): Promise<Solution | null> {
  if (!isSolutionPhase(phase)) throw new ValidationError("Unknown phase.");
  const current = await getSolution(userId, customerId, solutionId);
  if (!current) return null;
  return update(userId, customerId, solutionId, {
    currentPhase: phase,
    // Entering a post-sale phase means the customer said yes.
    ...(current.status === "active" && isGoingAheadPhase(phase)
      ? { status: "going_ahead" as const }
      : {}),
  });
}

/** Returns null if the solution does not exist. @throws ValidationError */
export async function setSolutionStatus(
  userId: string,
  customerId: string,
  solutionId: string,
  status: unknown,
): Promise<Solution | null> {
  if (!SOLUTION_STATUSES.includes(status as SolutionStatus)) {
    throw new ValidationError("Unknown status.");
  }
  return update(userId, customerId, solutionId, {
    status: status as SolutionStatus,
  });
}
