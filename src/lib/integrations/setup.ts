import type { IntegrationProvider } from "@/db/control-plane/schema";
import { requireEnv } from "@/db/env";

import { AtlassianAdapter } from "./atlassian/adapter";
import { GoogleAdapter } from "./google/adapter";
import { getAdapter, hasAdapter, registerAdapter } from "./registry";
import type { IntegrationAdapter } from "./types";

export interface ProviderInfo {
  provider: IntegrationProvider;
  name: string;
  description: string;
  /** Environment variables that must be set for this provider to work. */
  requiredEnv: readonly string[];
  /** Can also be connected with write access, for publishing documents. */
  canPublish?: boolean;
}

/** Add-ons that are on when ENABLED_INTEGRATIONS is not set. */
const DEFAULT_ENABLED = "google";

/**
 * Integrations are optional add-on modules, switched on by listing them in
 * ENABLED_INTEGRATIONS (comma-separated). A module that is off is not shown,
 * cannot be connected and is never called.
 */
export function isIntegrationEnabled(provider: IntegrationProvider): boolean {
  return (process.env.ENABLED_INTEGRATIONS ?? DEFAULT_ENABLED)
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .includes(provider);
}

export function enabledProviders(): ProviderInfo[] {
  return PROVIDERS.filter((info) => isIntegrationEnabled(info.provider));
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    provider: "google",
    name: "Google",
    description: "Gmail, Drive and Calendar (read-only).",
    requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  {
    provider: "atlassian",
    name: "Atlassian",
    description: "Confluence and Jira (read-only).",
    requiredEnv: ["ATLASSIAN_CLIENT_ID", "ATLASSIAN_CLIENT_SECRET"],
    canPublish: true,
  },
];

export function isProvider(value: string): value is IntegrationProvider {
  return PROVIDERS.some((info) => info.provider === value);
}

function build(provider: IntegrationProvider): IntegrationAdapter | null {
  if (!isIntegrationEnabled(provider)) return null;
  if (provider === "google") {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return null;
    }
    return new GoogleAdapter({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    });
  }
  if (provider === "atlassian") {
    if (
      !process.env.ATLASSIAN_CLIENT_ID ||
      !process.env.ATLASSIAN_CLIENT_SECRET
    ) {
      return null;
    }
    return new AtlassianAdapter({
      clientId: process.env.ATLASSIAN_CLIENT_ID,
      clientSecret: process.env.ATLASSIAN_CLIENT_SECRET,
    });
  }
  return null;
}

/**
 * The adapter for a provider, or null when it is not available (the add-on
 * is off, or no credentials are configured). An adapter registered
 * explicitly — e.g. a fake in tests — always wins.
 */
export function resolveAdapter(
  provider: IntegrationProvider,
): IntegrationAdapter | null {
  if (!hasAdapter(provider)) {
    const adapter = build(provider);
    if (!adapter) return null;
    registerAdapter(adapter);
  }
  return getAdapter(provider);
}

/** Where a provider sends the user back after they grant access. */
export function oauthRedirectUri(provider: IntegrationProvider): string {
  return new URL(
    `/api/integrations/${provider}/callback`,
    requireEnv("APP_URL"),
  ).toString();
}
