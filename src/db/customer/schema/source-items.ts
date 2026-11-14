import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";

export const SOURCE_ITEM_PROVIDERS = [
  "upload",
  "gmail",
  "google_drive",
  "confluence",
  "jira",
] as const;
export type SourceItemProvider = (typeof SOURCE_ITEM_PROVIDERS)[number];

/** One ingested item of customer context: an email, file, page or issue. */
export const sourceItems = pgTable(
  "source_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider", { enum: SOURCE_ITEM_PROVIDERS }).notNull(),
    /** Provider's identifier; null for direct uploads. */
    externalId: text("external_id"),
    /** Control-plane `customer_sources.id` that produced this item, if any. Not a foreign key: it lives in another database. */
    customerSourceId: uuid("customer_source_id"),
    title: text("title").notNull(),
    url: text("url"),
    /** Hash of the fetched content, to skip re-embedding unchanged items. */
    contentHash: text("content_hash"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("source_items_provider_external_id_unique").on(
      t.provider,
      t.externalId,
    ),
  ],
);

export type SourceItem = typeof sourceItems.$inferSelect;
export type NewSourceItem = typeof sourceItems.$inferInsert;
