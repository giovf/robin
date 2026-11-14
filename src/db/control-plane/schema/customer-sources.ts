import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { customers } from "./customers";
import { integrationConnections } from "./integration-connections";

export const CUSTOMER_SOURCE_KINDS = [
  "gmail",
  "google_drive",
  "confluence",
  "jira",
] as const;
export type CustomerSourceKind = (typeof CUSTOMER_SOURCE_KINDS)[number];

export const CUSTOMER_SOURCE_SYNC_STATUSES = [
  "running",
  "ok",
  "error",
] as const;
export type CustomerSourceSyncStatus =
  (typeof CUSTOMER_SOURCE_SYNC_STATUSES)[number];

/**
 * Provider-specific description of what to ingest, e.g. a Gmail filter
 * (labels/addresses/domains), a Drive folder id, a Confluence space key or a
 * Jira project key. Its shape is validated by the adapter for `kind`.
 */
export type CustomerSourceSelector = Record<string, unknown>;

/**
 * Which slices of an integration connection belong to a customer. This is
 * configuration only — the ingested content goes to the customer's database.
 */
export const customerSources = pgTable(
  "customer_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: CUSTOMER_SOURCE_KINDS }).notNull(),
    /** Display name, e.g. the Gmail label or Drive folder name. */
    name: text("name").notNull(),
    selector: jsonb("selector").$type<CustomerSourceSelector>().notNull(),
    /** Outcome of the latest sync; null until the first one. */
    lastSyncStatus: text("last_sync_status", {
      enum: CUSTOMER_SOURCE_SYNC_STATUSES,
    }),
    lastSyncStartedAt: timestamp("last_sync_started_at", {
      withTimezone: true,
    }),
    /** When the latest successful sync finished. */
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Items seen by the latest sync. A count only — never content. */
    lastSyncItemCount: integer("last_sync_item_count"),
    /** A generic failure reason. Never provider payloads or content. */
    lastSyncError: text("last_sync_error"),
    ...timestamps,
  },
  (t) => [
    index("customer_sources_customer_id_idx").on(t.customerId),
    index("customer_sources_connection_id_idx").on(t.connectionId),
  ],
);

export type CustomerSource = typeof customerSources.$inferSelect;
export type NewCustomerSource = typeof customerSources.$inferInsert;
