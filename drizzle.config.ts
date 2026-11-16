import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

// drizzle-kit does not read .env on its own.
if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}

/** Control-plane migration track (database `robin`). */
export default defineConfig({
  schema: "./src/db/control-plane/schema/index.ts",
  out: "./drizzle/control-plane",
  dialect: "postgresql",
  dbCredentials: { url },
});
