import { and, eq } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import {
  integrationConnections,
  type IntegrationConnection,
} from "@/db/control-plane/schema";
import { isUuid } from "@/db/customer/database-url";

import { decryptToken, encryptToken } from "../encryption";
import type {
  ConnectedAccount,
  IntegrationProvider,
  OAuthTokens,
} from "./types";

/** A connection as shown in the hub: no token material. */
export type IntegrationConnectionSummary = Pick<
  IntegrationConnection,
  | "id"
  | "provider"
  | "accountLabel"
  | "externalAccountId"
  | "scopes"
  | "status"
  | "createdAt"
>;

const summary = {
  id: integrationConnections.id,
  provider: integrationConnections.provider,
  accountLabel: integrationConnections.accountLabel,
  externalAccountId: integrationConnections.externalAccountId,
  scopes: integrationConnections.scopes,
  status: integrationConnections.status,
  createdAt: integrationConnections.createdAt,
};

function owned(organizationId: string, connectionId: string) {
  return and(
    eq(integrationConnections.id, connectionId),
    eq(integrationConnections.organizationId, organizationId),
  );
}

function encrypted(tokens: OAuthTokens) {
  return {
    encryptedAccessToken: encryptToken(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt ?? null,
    scopes: tokens.scopes,
    // Providers often omit the refresh token on refresh: keep the stored one.
    ...(tokens.refreshToken
      ? { encryptedRefreshToken: encryptToken(tokens.refreshToken) }
      : {}),
  };
}

/** Stores a new connection for the organisation, encrypting its tokens. */
export async function saveIntegrationConnection(input: {
  organizationId: string;
  provider: IntegrationProvider;
  account: ConnectedAccount;
  tokens: OAuthTokens;
}): Promise<IntegrationConnectionSummary> {
  const [connection] = await getControlPlaneDb()
    .insert(integrationConnections)
    .values({
      organizationId: input.organizationId,
      provider: input.provider,
      externalAccountId: input.account.externalAccountId,
      accountLabel: input.account.label,
      ...encrypted(input.tokens),
    })
    .returning(summary);
  return connection;
}

export async function listIntegrationConnections(
  organizationId: string,
): Promise<IntegrationConnectionSummary[]> {
  return getControlPlaneDb()
    .select(summary)
    .from(integrationConnections)
    .where(eq(integrationConnections.organizationId, organizationId))
    .orderBy(integrationConnections.createdAt);
}

/**
 * Decrypted tokens for one of the organisation's connections, or null if the
 * connection is not theirs.
 */
export async function getIntegrationTokens(
  organizationId: string,
  connectionId: string,
): Promise<OAuthTokens | null> {
  if (!isUuid(connectionId)) return null;
  const [row] = await getControlPlaneDb()
    .select()
    .from(integrationConnections)
    .where(owned(organizationId, connectionId))
    .limit(1);
  if (!row) return null;
  return {
    accessToken: decryptToken(row.encryptedAccessToken),
    refreshToken: row.encryptedRefreshToken
      ? decryptToken(row.encryptedRefreshToken)
      : undefined,
    expiresAt: row.accessTokenExpiresAt ?? undefined,
    scopes: row.scopes,
  };
}

/** Replaces a connection's tokens after a refresh. Returns false if not theirs. */
export async function updateIntegrationTokens(
  organizationId: string,
  connectionId: string,
  tokens: OAuthTokens,
): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const updated = await getControlPlaneDb()
    .update(integrationConnections)
    .set({ ...encrypted(tokens), status: "active" })
    .where(owned(organizationId, connectionId))
    .returning({ id: integrationConnections.id });
  return updated.length > 0;
}

/** Deletes a connection (and, by cascade, the customer sources using it). */
export async function deleteIntegrationConnection(
  organizationId: string,
  connectionId: string,
): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const deleted = await getControlPlaneDb()
    .delete(integrationConnections)
    .where(owned(organizationId, connectionId))
    .returning({ id: integrationConnections.id });
  return deleted.length > 0;
}
