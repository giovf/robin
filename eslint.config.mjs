import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turn off ESLint rules that conflict with Prettier (formatting is Prettier's job).
  prettier,
  // A leading underscore marks a deliberately unused binding.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
    },
  },
  // Customer isolation: raw customer-database pools carry no ownership check.
  // Only the resolver and provisioning may touch them.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/lib/customer-connection.ts",
      "src/lib/customer-provisioning.ts",
      "src/db/customer/pools.ts",
      "src/**/*.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^@/db/customer/pools$)|(/pools$)",
              message:
                "Get customer database connections through getCustomerConnection (@/lib/customer-connection).",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "graphify-out/**",
  ]),
]);

export default eslintConfig;
