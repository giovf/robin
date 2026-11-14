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
  },
];

export function isProvider(value: string): value is IntegrationProvider {
  return PROVIDERS.some((info) => info.provider === value);
}

function build(provider: IntegrationProvider): IntegrationAdapter | null {
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
 * The adapter for a provider, or null when it is not available (no
 * credentials configured, or not implemented yet). An adapter registered
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
