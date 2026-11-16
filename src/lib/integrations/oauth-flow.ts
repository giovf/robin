import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { CurrentUser } from "../session";
import { saveIntegrationConnection } from "./connections";
import { IntegrationError } from "./errors";
import { isProvider, oauthRedirectUri, resolveAdapter } from "./setup";

/*
 * The OAuth "connect" flow, independent of the web framework so it can be
 * tested directly: the route handlers only pass the request in and turn the
 * result into a redirect.
 */

export const OAUTH_STATE_COOKIE = "robin_oauth_state";
export const OAUTH_STATE_MAX_AGE_SECONDS = 600;

export type OAuthStart =
  | { ok: true; authorizationUrl: string; state: string }
  | { ok: false; error: OAuthFailure };

export type OAuthFailure =
  | "unknown_provider"
  | "not_configured"
  | "state_mismatch"
  | "access_denied"
  | "exchange_failed";

export const OAUTH_FAILURE_MESSAGES: Record<OAuthFailure, string> = {
  unknown_provider: "That integration does not exist.",
  not_configured:
    "This integration is not configured yet: its client id and secret are missing.",
  state_mismatch:
    "The connection attempt could not be verified. Please try again.",
  access_denied: "Access was not granted, so nothing was connected.",
  exchange_failed: "The provider rejected the connection. Please try again.",
};

/** Step 1: where to send the user, plus the state to remember in a cookie. */
export function startOAuth(
  provider: string,
  options: { publish?: boolean } = {},
): OAuthStart {
  if (!isProvider(provider)) return { ok: false, error: "unknown_provider" };
  const adapter = resolveAdapter(provider);
  if (!adapter) return { ok: false, error: "not_configured" };
  const state = randomBytes(32).toString("base64url");
  return {
    ok: true,
    state,
    authorizationUrl: adapter.getAuthorizationUrl({
      state,
      redirectUri: oauthRedirectUri(provider),
      // Write scopes only when the user explicitly asked for publishing access.
      scopes:
        options.publish && adapter.publishScopes
          ? [...adapter.defaultScopes, ...adapter.publishScopes]
          : undefined,
    }),
  };
}

function sameState(
  expected: string | undefined,
  actual: string | null,
): boolean {
  if (!expected || !actual) return false;
  const digest = (value: string): Buffer =>
    createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(expected), digest(actual));
}

/**
 * Step 2: the provider sent the user back. Verifies the state (CSRF), swaps
 * the code for tokens and stores the connection for the user's organisation.
 */
export async function completeOAuth(input: {
  provider: string;
  user: Pick<CurrentUser, "organizationId">;
  /** Query parameters of the callback request. */
  query: URLSearchParams;
  /** The state remembered in the cookie at step 1. */
  expectedState: string | undefined;
}): Promise<{ ok: true } | { ok: false; error: OAuthFailure }> {
  const { provider, query } = input;
  if (!isProvider(provider)) return { ok: false, error: "unknown_provider" };
  const adapter = resolveAdapter(provider);
  if (!adapter) return { ok: false, error: "not_configured" };
  if (!sameState(input.expectedState, query.get("state"))) {
    return { ok: false, error: "state_mismatch" };
  }
  const code = query.get("code");
  if (query.get("error") || !code) return { ok: false, error: "access_denied" };

  try {
    const tokens = await adapter.exchangeCodeForTokens({
      code,
      redirectUri: oauthRedirectUri(provider),
    });
    const account = await adapter.getAccount(tokens);
    await saveIntegrationConnection({
      organizationId: input.user.organizationId,
      provider,
      account,
      tokens,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof IntegrationError) {
      return { ok: false, error: "exchange_failed" };
    }
    throw error;
  }
}
