import { asc, count, desc, eq, sql } from "drizzle-orm";

import { isUuid } from "@/db/customer/database-url";
import { chunks, sourceItems, type SourceItem } from "@/db/customer/schema";

import { getCustomerConnection } from "./customer-connection";

/*
 * Read access to what Robin has ingested for a customer ("what does Robin
 * know?"). Everything goes through the customer-connection resolver.
 */

export interface SourceItemSummary extends SourceItem {
  chunkCount: number;
}

export interface KnowledgeTotals {
  itemCount: number;
  chunkCount: number;
}

export async function getKnowledgeTotals(
  userId: string,
  customerId: string,
): Promise<KnowledgeTotals> {
  const db = await getCustomerConnection(userId, customerId);
  const [[items], [pieces]] = await Promise.all([
    db.select({ value: count() }).from(sourceItems),
    db.select({ value: count() }).from(chunks),
  ]);
  return { itemCount: items.value, chunkCount: pieces.value };
}

export const SOURCE_ITEMS_PAGE_SIZE = 50;

/** Ingested items, most recently synced first, with their chunk counts. */
export async function listSourceItems(
  userId: string,
  customerId: string,
  options: { page?: number; customerSourceId?: string } = {},
): Promise<SourceItemSummary[]> {
  const db = await getCustomerConnection(userId, customerId);
  const page = Math.max(options.page ?? 1, 1);
  const rows = await db
    .select({
      item: sourceItems,
      chunkCount: sql<number>`count(${chunks.id})`.mapWith(Number),
    })
    .from(sourceItems)
    .leftJoin(chunks, eq(chunks.sourceItemId, sourceItems.id))
    .where(
      options.customerSourceId && isUuid(options.customerSourceId)
        ? eq(sourceItems.customerSourceId, options.customerSourceId)
        : undefined,
    )
    .groupBy(sourceItems.id)
    .orderBy(desc(sourceItems.syncedAt), asc(sourceItems.title))
    .limit(SOURCE_ITEMS_PAGE_SIZE)
    .offset((page - 1) * SOURCE_ITEMS_PAGE_SIZE);
  return rows.map((row) => ({ ...row.item, chunkCount: row.chunkCount }));
}

export interface SourceItemDetail extends SourceItem {
  chunks: { id: string; chunkIndex: number; text: string }[];
}

/** One ingested item with its chunks in order, or null if it does not exist. */
export async function getSourceItem(
  userId: string,
  customerId: string,
  sourceItemId: string,
): Promise<SourceItemDetail | null> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(sourceItemId)) return null;
  const [item] = await db
    .select()
    .from(sourceItems)
    .where(eq(sourceItems.id, sourceItemId))
    .limit(1);
  if (!item) return null;
  const pieces = await db
    .select({ id: chunks.id, chunkIndex: chunks.chunkIndex, text: chunks.text })
    .from(chunks)
    .where(eq(chunks.sourceItemId, item.id))
    .orderBy(asc(chunks.chunkIndex));
  return { ...item, chunks: pieces };
}

/** Removes an ingested item and its chunks. Returns false if it did not exist. */
export async function deleteSourceItem(
  userId: string,
  customerId: string,
  sourceItemId: string,
): Promise<boolean> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(sourceItemId)) return false;
  const deleted = await db
    .delete(sourceItems)
    .where(eq(sourceItems.id, sourceItemId))
    .returning({ id: sourceItems.id });
  return deleted.length > 0;
}
