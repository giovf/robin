import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { sql } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import * as schema from "@/db/control-plane/schema";
import { requireEnv } from "@/db/env";

import { ensureDefaultOrganization } from "./onboarding";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Whether a new account may be created. v1 is single-user: sign-up is open
 * only until the first user exists, unless ALLOW_SIGNUP=true.
 */
export async function isSignUpOpen(): Promise<boolean> {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  const result = await getControlPlaneDb().execute(
    sql`select 1 from ${schema.users} limit 1`,
  );
  return result.rows.length === 0;
}

function createAuth() {
  return betterAuth({
    secret: requireEnv("AUTH_SECRET"),
    baseURL: requireEnv("APP_URL"),
    database: drizzleAdapter(getControlPlaneDb(), {
      provider: "pg",
      usePlural: true,
      schema,
    }),
    advanced: { database: { generateId: "uuid" } },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: 60 * 60 * 24,
    },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (!(await isSignUpOpen())) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-up is closed.",
              });
            }
          },
          after: async (user) => {
            await ensureDefaultOrganization(user);
          },
        },
      },
    },
    // Must stay last: lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & {
  __robinAuth?: Auth;
};

/** The auth instance, created lazily so builds don't need runtime secrets. */
export function getAuth(): Auth {
  globalForAuth.__robinAuth ??= createAuth();
  return globalForAuth.__robinAuth;
}
