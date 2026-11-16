/**
 * Connection pools for customer databases — one pool per database.
 *
 * RESTRICTED MODULE: this hands out connections WITHOUT an ownership check.
 * Only the customer-connection resolver (`@/lib/customer-connection`) and
 * provisioning (`@/lib/customer-provisioning`) may import it; ESLint enforces
 * this. Everything else calls `getCustomerConnection`.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildCustomerDatabaseUrl } from "./database-url";
import * as schema from "./schema";

export type CustomerDb = NodePgDatabase<typeof schema>;

/** Connections per customer database. */
const MAX_CONNECTIONS_PER_POOL = 5;
/** An idle connection is closed after this long. */
const CONNECTION_IDLE_MS = 30_000;
/** A pool nobody has asked for in this long is closed and forgotten. */
const POOL_IDLE_MS = 10 * 60_000;
/** Upper bound on open pools; the least recently used are closed beyond it. */
const MAX_POOLS = 50;

interface PoolEntry {
  pool: Pool;
  db: CustomerDb;
  lastUsed: number;
}

const globalForPools = globalThis as typeof globalThis & {
  __robinCustomerPools?: Map<string, PoolEntry>;
};

function entries(): Map<string, PoolEntry> {
  globalForPools.__robinCustomerPools ??= new Map();
  return globalForPools.__robinCustomerPools;
}

function isBusy(pool: Pool): boolean {
  return pool.totalCount > pool.idleCount || pool.waitingCount > 0;
}

function endQuietly(pool: Pool): void {
  pool.end().catch((error: unknown) => {
    console.error("Failed to close customer database pool", error);
  });
}

/** Closes pools that have gone unused, and the oldest ones beyond MAX_POOLS. */
function evictStalePools(now: number): void {
  const all = entries();
  const oldestFirst = [...all].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  let excess = all.size - MAX_POOLS;
  for (const [name, entry] of oldestFirst) {
    const expired = now - entry.lastUsed > POOL_IDLE_MS;
    if ((!expired && excess <= 0) || isBusy(entry.pool)) continue;
    all.delete(name);
    endQuietly(entry.pool);
    excess -= 1;
  }
}

/**
 * Returns the Drizzle client for a customer database, creating its pool on
 * first use. Fetch it per request rather than holding on to it: an unused
 * pool is closed after POOL_IDLE_MS.
 */
export function getCustomerDb(databaseName: string): CustomerDb {
  const now = Date.now();
  const all = entries();
  let entry = all.get(databaseName);
  if (!entry) {
    const pool = new Pool({
      connectionString: buildCustomerDatabaseUrl(databaseName),
      max: MAX_CONNECTIONS_PER_POOL,
      idleTimeoutMillis: CONNECTION_IDLE_MS,
      allowExitOnIdle: true,
    });
    // An idle client can error (e.g. the database was dropped); without a
    // listener that would crash the process.
    pool.on("error", (error) => {
      console.error(`Customer database pool error (${databaseName})`, error);
    });
    entry = { pool, db: drizzle(pool, { schema }), lastUsed: now };
    all.set(databaseName, entry);
  }
  entry.lastUsed = now;
  evictStalePools(now);
  return entry.db;
}

/** Closes one customer's pool, e.g. before its database is renamed or dropped. */
export async function closeCustomerPool(databaseName: string): Promise<void> {
  const entry = entries().get(databaseName);
  if (!entry) return;
  entries().delete(databaseName);
  await entry.pool.end();
}

/** Closes every customer pool. For shutdown, scripts and tests. */
export async function closeAllCustomerPools(): Promise<void> {
  const all = [...entries().values()];
  entries().clear();
  await Promise.all(all.map((entry) => entry.pool.end()));
}

/** Number of open customer pools. For diagnostics and tests. */
export function openCustomerPoolCount(): number {
  return entries().size;
}
