import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { requireEnv } from "@/db/env";

import * as schema from "./schema";

export type ControlPlaneDb = NodePgDatabase<typeof schema>;

// Next.js dev (HMR) re-evaluates modules; cache the pool on globalThis so
// reloads don't leak connections.
const globalForDb = globalThis as typeof globalThis & {
  __robinControlPlanePool?: Pool;
};

function getPool(): Pool {
  if (!globalForDb.__robinControlPlanePool) {
    globalForDb.__robinControlPlanePool = new Pool({
      connectionString: requireEnv("DATABASE_URL"),
    });
  }
  return globalForDb.__robinControlPlanePool;
}

let cached: ControlPlaneDb | undefined;

/**
 * Returns the singleton Drizzle client for the control-plane database
 * (`robin`). Created lazily so importing this module (e.g. during
 * `next build`) does not require DATABASE_URL or open a connection.
 *
 * Never use this for customer content — customer-scoped code goes through the
 * customer-connection resolver.
 */
export function getControlPlaneDb(): ControlPlaneDb {
  cached ??= drizzle(getPool(), { schema });
  return cached;
}

/** Startup/health check: throws if the control-plane database is unreachable. */
export async function verifyControlPlaneConnection(): Promise<void> {
  await getControlPlaneDb().execute(sql`select 1`);
}

/** Closes the pool. For scripts and tests; the app keeps it open. */
export async function closeControlPlaneDb(): Promise<void> {
  const pool = globalForDb.__robinControlPlanePool;
  globalForDb.__robinControlPlanePool = undefined;
  cached = undefined;
  await pool?.end();
}
