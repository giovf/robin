import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

const TEST_DATABASE = "robin_test";

async function withClient<T>(
  connectionString: string,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** Drops the test control plane and every customer database registered in it. */
async function dropTestDatabases(
  adminUrl: string,
  testUrl: string,
): Promise<void> {
  await withClient(adminUrl, async (admin) => {
    const exists = await admin.query(
      "select 1 from pg_database where datname = $1",
      [TEST_DATABASE],
    );
    if (exists.rowCount) {
      const names = await withClient(testUrl, async (test) => {
        const registered = await test.query<{ database_name: string }>(
          "select database_name from customers",
        );
        return registered.rows.map((row) => row.database_name);
      }).catch(() => [] as string[]);
      for (const name of names) {
        if (!/^customer_[0-9a-f_]+$/.test(name)) continue;
        await admin.query(`drop database if exists "${name}" with (force)`);
        await admin.query(
          `drop database if exists "archived_${name}" with (force)`,
        );
      }
    }
    await admin.query(
      `drop database if exists "${TEST_DATABASE}" with (force)`,
    );
  });
}

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const env = project.config.env;
  const adminUrl = env.ROBIN_ADMIN_DATABASE_URL;
  const testUrl = env.DATABASE_URL;
  if (!adminUrl || !testUrl || !testUrl.endsWith(`/${TEST_DATABASE}`)) {
    throw new Error("Test database URLs are not configured as expected.");
  }

  await dropTestDatabases(adminUrl, testUrl);
  await withClient(adminUrl, (admin) =>
    admin.query(`create database "${TEST_DATABASE}"`),
  );
  await withClient(testUrl, (client) =>
    migrate(drizzle(client), {
      migrationsFolder: path.join(process.cwd(), "drizzle", "control-plane"),
    }),
  );

  return () => dropTestDatabases(adminUrl, testUrl);
}
