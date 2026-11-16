import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import { calls } from "./calls";
import { createdAt } from "./columns";
import { sourceItems } from "./source-items";

/**
 * Size of the embedding vectors: 384, the output of `multilingual-e5-small`
 * (see `src/lib/embeddings.ts`). A model with a different size needs a
 * customer-schema migration that alters the column and re-embeds the chunks.
 */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * A retrievable piece of customer context. Belongs to exactly one origin:
 * an ingested source item or a call transcript.
 */
export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceItemId: uuid("source_item_id").references(() => sourceItems.id, {
      onDelete: "cascade",
    }),
    callId: uuid("call_id").references(() => calls.id, {
      onDelete: "cascade",
    }),
    /** Position of this chunk within its origin. */
    chunkIndex: integer("chunk_index").notNull(),
    text: text("text").notNull(),
    /** Null until the chunk has been embedded. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    /** Model that produced `embedding`, so a provider change can be detected. */
    embeddingModel: text("embedding_model"),
    createdAt,
  },
  (t) => [
    check(
      "chunks_exactly_one_origin",
      sql`num_nonnulls(${t.sourceItemId}, ${t.callId}) = 1`,
    ),
    index("chunks_source_item_id_idx").on(t.sourceItemId),
    index("chunks_call_id_idx").on(t.callId),
    index("chunks_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export type Chunk = typeof chunks.$inferSelect;
export type NewChunk = typeof chunks.$inferInsert;
