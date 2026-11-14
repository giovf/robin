import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";

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
    ...timestamps,
  },
  (t) => [
    index("customer_sources_customer_id_idx").on(t.customerId),
    index("customer_sources_connection_id_idx").on(t.connectionId),
  ],
);

export type CustomerSource = typeof customerSources.$inferSelect;
export type NewCustomerSource = typeof customerSources.$inferInsert;
