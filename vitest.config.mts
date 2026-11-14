import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "vitest/config";

if (existsSync(".env")) process.loadEnvFile(".env");

// Tests never touch the dev database: they run against a throwaway control
// plane (`robin_test`) on the same server, created by src/test/global-setup.ts.
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
}
const testUrl = new URL(devUrl);
testUrl.pathname = "/robin_test";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/test/global-setup.ts"],
    // Test files share one Postgres server and create/drop databases on it.
    fileParallelism: false,
    env: {
      DATABASE_URL: testUrl.toString(),
      ROBIN_ADMIN_DATABASE_URL: devUrl,
      AUTH_SECRET: "test-only-secret-test-only-secret-0123456789",
      APP_URL: "http://localhost:3000",
      ALLOW_SIGNUP: "",
    },
  },
});
