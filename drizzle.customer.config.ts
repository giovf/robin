import { defineConfig } from "drizzle-kit";

/**
 * Customer migration track. Only used to *generate* migrations: there is no
 * single customer database, so no credentials here. The app applies these
 * migrations to each customer database on provisioning and on upgrade.
 */
export default defineConfig({
  schema: "./src/db/customer/schema/index.ts",
  out: "./drizzle/customer",
  dialect: "postgresql",
});
