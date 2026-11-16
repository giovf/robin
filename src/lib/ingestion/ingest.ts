import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import {
  chunks,
  sourceItems,
  type SourceItem,
  type SourceItemProvider,
} from "@/db/customer/schema";

import { chunkText } from "../chunking";
import type { CustomerDb } from "../customer-connection";
import { embedTexts, getEmbeddingProvider } from "../embeddings";

export interface IngestInput {
  provider: SourceItemProvider;
  /** Provider's stable id for the item; identifies it across syncs. */
  externalId: string;
  title: string;
  url?: string;
  /** Plain text. */
  text: string;
  /** Control-plane `customer_sources.id` this came from, if any. */
  customerSourceId?: string;
}

export interface IngestResult {
  sourceItem: SourceItem;
  /** False when the content was already stored unchanged. */
  changed: boolean;
  chunkCount: number;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Stores one item of context in a customer's database: chunks it, embeds the
 * chunks and replaces whatever was stored for the same item before. Unchanged
 * content (same hash, same embedding model) is skipped.
 *
 * `db` must come from the customer-connection resolver — that is what scopes
 * the write to one customer.
 */
export async function ingestItem(
  db: CustomerDb,
  input: IngestInput,
): Promise<IngestResult> {
  const hash = contentHash(input.text);
  const model = getEmbeddingProvider().id;

  const [existing] = await db
    .select()
    .from(sourceItems)
    .where(
      and(
        eq(sourceItems.provider, input.provider),
        eq(sourceItems.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing?.contentHash === hash) {
    const [embedded] = await db
      .select({ model: chunks.embeddingModel })
      .from(chunks)
      .where(eq(chunks.sourceItemId, existing.id))
      .limit(1);
    if (embedded?.model === model) {
      const [sourceItem] = await db
        .update(sourceItems)
        .set({ syncedAt: new Date(), title: input.title, url: input.url })
        .where(eq(sourceItems.id, existing.id))
        .returning();
      return { sourceItem, changed: false, chunkCount: 0 };
    }
  }

  // Embed before opening the transaction: it may be a slow network call.
  const pieces = chunkText(input.text);
  const vectors = await embedTexts(pieces);

  return db.transaction(async (tx) => {
    const values = {
      provider: input.provider,
      externalId: input.externalId,
      customerSourceId: input.customerSourceId,
      title: input.title,
      url: input.url,
      contentHash: hash,
      syncedAt: new Date(),
    };
    const [sourceItem] = existing
      ? await tx
          .update(sourceItems)
          .set(values)
          .where(eq(sourceItems.id, existing.id))
          .returning()
      : await tx.insert(sourceItems).values(values).returning();

    await tx.delete(chunks).where(eq(chunks.sourceItemId, sourceItem.id));
    if (pieces.length) {
      await tx.insert(chunks).values(
        pieces.map((text, chunkIndex) => ({
          sourceItemId: sourceItem.id,
          chunkIndex,
          text,
          embedding: vectors[chunkIndex],
          embeddingModel: model,
        })),
      );
    }
    return { sourceItem, changed: true, chunkCount: pieces.length };
  });
}
