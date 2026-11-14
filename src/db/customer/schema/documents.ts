import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, timestamps } from "./columns";
import { solutions } from "./solutions";

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutions.id, { onDelete: "cascade" }),
    /** Document template key, e.g. `discovery-summary`. */
    templateId: text("template_id"),
    /** Life-cycle phase this document belongs to. */
    phase: text("phase"),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("documents_solution_id_idx").on(t.solutionId)],
);

/** Points a passage of a document back at the source it was drawn from. */
export interface DocumentCitation {
  /** `chunks.id` the passage is grounded in. */
  chunkId?: string;
  /** `source_items.id` the passage is grounded in. */
  sourceItemId?: string;
  /** `calls.id` when the source is a call transcript. */
  callId?: string;
  /** The quoted or paraphrased source text. */
  text?: string;
  /** Where in the document the citation applies (e.g. a heading or marker). */
  location?: string;
}

/** Immutable snapshot of a document's content; the highest `version` is current. */
export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    citations: jsonb("citations")
      .$type<DocumentCitation[]>()
      .default([])
      .notNull(),
    /** Control-plane user id, or `agent` for agent drafts. Not a foreign key: users live in another database. */
    createdBy: text("created_by"),
    createdAt,
  },
  (t) => [
    unique("document_versions_document_version_unique").on(
      t.documentId,
      t.version,
    ),
  ],
);

export type DocumentRecord = typeof documents.$inferSelect;
export type NewDocumentRecord = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
