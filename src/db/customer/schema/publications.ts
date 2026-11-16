import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt } from "./columns";
import { documents } from "./documents";

/**
 * Audit log of writes to the customer's own systems: one row each time a
 * document version is published (e.g. as a Confluence page). Append-only.
 */
export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** The document version that was published. */
    version: integer("version").notNull(),
    /** Where it went, e.g. `confluence`. */
    destination: text("destination").notNull(),
    /** Human-readable target, e.g. the space name. */
    targetLabel: text("target_label").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    /** Control-plane user id of whoever confirmed the publication. */
    publishedBy: text("published_by").notNull(),
    createdAt,
  },
  (t) => [index("publications_document_id_idx").on(t.documentId)],
);

export type Publication = typeof publications.$inferSelect;
