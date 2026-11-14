import { and, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";

import {
  calls,
  chunks,
  sourceItems,
  type SourceItemProvider,
} from "@/db/customer/schema";

import { getCustomerConnection } from "./customer-connection";
import { getEmbeddingProvider } from "./embeddings";

export interface RetrievalOptions {
  /** Maximum number of chunks to return. Default 8. */
  limit?: number;
  /** Drop results less similar than this (cosine similarity, -1…1). */
  minSimilarity?: number;
  /** Only chunks from these kinds of source. */
  providers?: SourceItemProvider[];
  /** Only chunks from items synced at or after this time. */
  syncedSince?: Date;
}

export interface RetrievalResult {
  chunkId: string;
  text: string;
  /** Cosine similarity to the query; higher is closer. */
  similarity: number;
  /** Where the chunk came from: an ingested item or a call transcript. */
  source:
    | {
        type: "source_item";
        id: string;
        provider: SourceItemProvider;
        title: string;
        url: string | null;
      }
    | { type: "call"; id: string; title: string | null };
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

/**
 * Finds the chunks of ONE customer's context most similar to a query. The
 * connection comes from the resolver, so the search can only ever see that
 * customer's database.
 *
 * @throws CustomerConnectionError if the user may not access the customer.
 */
export async function retrieveContext(
  userId: string,
  customerId: string,
  query: string,
  options: RetrievalOptions = {},
): Promise<RetrievalResult[]> {
  const db = await getCustomerConnection(userId, customerId);
  const text = query.trim();
  if (!text) return [];

  const embedder = getEmbeddingProvider();
  const [vector] = await embedder.embed([text]);
  const distance = sql`${chunks.embedding} <=> ${JSON.stringify(vector)}::vector`;
  const limit = Math.min(
    Math.max(options.limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const rows = await db
    .select({
      chunkId: chunks.id,
      text: chunks.text,
      similarity: sql<number>`1 - (${distance})`.mapWith(Number),
      sourceItemId: sourceItems.id,
      provider: sourceItems.provider,
      title: sourceItems.title,
      url: sourceItems.url,
      callId: calls.id,
      callTitle: calls.title,
    })
    .from(chunks)
    .leftJoin(sourceItems, eq(chunks.sourceItemId, sourceItems.id))
    .leftJoin(calls, eq(chunks.callId, calls.id))
    .where(
      and(
        isNotNull(chunks.embedding),
        // Vectors from another model are not comparable with this query.
        eq(chunks.embeddingModel, embedder.id),
        options.providers?.length
          ? inArray(sourceItems.provider, options.providers)
          : undefined,
        options.syncedSince
          ? gte(sourceItems.syncedAt, options.syncedSince)
          : undefined,
      ),
    )
    .orderBy(distance)
    .limit(limit);

  const results: RetrievalResult[] = [];
  for (const row of rows) {
    if (
      options.minSimilarity !== undefined &&
      row.similarity < options.minSimilarity
    ) {
      continue;
    }
    if (row.sourceItemId && row.provider && row.title !== null) {
      results.push({
        chunkId: row.chunkId,
        text: row.text,
        similarity: row.similarity,
        source: {
          type: "source_item",
          id: row.sourceItemId,
          provider: row.provider,
          title: row.title,
          url: row.url,
        },
      });
    } else if (row.callId) {
      results.push({
        chunkId: row.chunkId,
        text: row.text,
        similarity: row.similarity,
        source: { type: "call", id: row.callId, title: row.callTitle },
      });
    }
  }
  return results;
}
