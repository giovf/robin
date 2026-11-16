import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { organizations } from "./organizations";

export const INTEGRATION_PROVIDERS = ["google", "atlassian"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_CONNECTION_STATUSES = [
  "active",
  "needs_reauth",
  "revoked",
] as const;
export type IntegrationConnectionStatus =
  (typeof INTEGRATION_CONNECTION_STATUSES)[number];

/**
 * An organisation's OAuth connection to an external provider. Token columns
 * hold ciphertext only (encrypted with TOKEN_ENCRYPTION_KEY) — never plaintext.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: INTEGRATION_PROVIDERS }).notNull(),
    /** Provider-side account identifier (Google subject, Atlassian cloud id). */
    externalAccountId: text("external_account_id"),
    /** Human-readable label for the hub UI, e.g. the connected account email. */
    accountLabel: text("account_label"),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    scopes: text("scopes").array().notNull().default([]),
    status: text("status", { enum: INTEGRATION_CONNECTION_STATUSES })
      .default("active")
      .notNull(),
    ...timestamps,
  },
  (t) => [
    index("integration_connections_organization_id_idx").on(t.organizationId),
  ],
);

export type IntegrationConnection = typeof integrationConnections.$inferSelect;
export type NewIntegrationConnection =
  typeof integrationConnections.$inferInsert;
