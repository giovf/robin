import { eq, getTableColumns } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import { customerSources } from "@/db/control-plane/schema";
import {
  agentConfig,
  agentMemory,
  calls,
  chunks,
  diagrams,
  documents,
  documentVersions,
  publications,
  solutions,
  sourceItems,
  suggestions,
  transcriptSegments,
} from "@/db/customer/schema";

import { getCustomerConnection } from "./customer-connection";
import { getCustomer } from "./customers";
import type { CurrentUser } from "./session";

export const CUSTOMER_EXPORT_FORMAT_VERSION = 1;

export type CustomerExport = Awaited<ReturnType<typeof buildExport>>;

async function buildExport(
  user: Pick<CurrentUser, "id" | "organizationId">,
  customerId: string,
) {
  const customer = await getCustomer(user.organizationId, customerId);
  // Throws CustomerConnectionError unless the user may access this customer.
  const db = await getCustomerConnection(user.id, customerId);
  if (!customer) return null;

  // Embedding vectors are left out: they are derived data, regenerable from
  // the chunk text, and would dominate the file size.
  const { embedding: _embedding, ...chunkColumns } = getTableColumns(chunks);

  return {
    formatVersion: CUSTOMER_EXPORT_FORMAT_VERSION,
    exportedAt: new Date(),
    customer,
    contextSources: await getControlPlaneDb()
      .select({
        id: customerSources.id,
        kind: customerSources.kind,
        name: customerSources.name,
        selector: customerSources.selector,
        createdAt: customerSources.createdAt,
      })
      .from(customerSources)
      .where(eq(customerSources.customerId, customer.id)),
    solutions: await db.select().from(solutions),
    calls: await db.select().from(calls),
    transcriptSegments: await db.select().from(transcriptSegments),
    suggestions: await db.select().from(suggestions),
    documents: await db.select().from(documents),
    documentVersions: await db.select().from(documentVersions),
    publications: await db.select().from(publications),
    diagrams: await db.select().from(diagrams),
    sourceItems: await db.select().from(sourceItems),
    chunks: await db.select(chunkColumns).from(chunks),
    agentConfig: await db.select().from(agentConfig),
    agentMemory: await db.select().from(agentMemory),
  };
}

/**
 * Everything Robin holds about one customer (GDPR export), as one
 * JSON-serialisable object. Nothing is written to disk.
 *
 * @throws CustomerConnectionError if the user may not access the customer.
 */
export async function exportCustomerData(
  user: Pick<CurrentUser, "id" | "organizationId">,
  customerId: string,
): Promise<NonNullable<CustomerExport>> {
  const data = await buildExport(user, customerId);
  if (!data) throw new Error("Customer vanished during export.");
  return data;
}
