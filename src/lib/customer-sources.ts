import { and, eq } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import {
  CUSTOMER_SOURCE_KINDS,
  customerSources,
  integrationConnections,
  type CustomerSource,
  type CustomerSourceKind,
} from "@/db/control-plane/schema";
import { isUuid } from "@/db/customer/database-url";

import { getCustomer } from "./customers";
import {
  getFreshIntegrationTokens,
  IntegrationError,
  resolveAdapter,
  type IntegrationSource,
} from "./integrations";
import { requiredText, ValidationError } from "./validation";

/*
 * Which slices of an integration belong to which customer. This is selection
 * (configuration) only; ingestion reads these rows later.
 *
 * Every function checks that the customer — and, where relevant, the
 * connection — belongs to the caller's organisation.
 */

export type CustomerSourceSummary = Pick<
  CustomerSource,
  | "id"
  | "connectionId"
  | "kind"
  | "name"
  | "selector"
  | "createdAt"
  | "lastSyncStatus"
  | "lastSyncStartedAt"
  | "lastSyncedAt"
  | "lastSyncItemCount"
  | "lastSyncError"
>;

const summary = {
  id: customerSources.id,
  connectionId: customerSources.connectionId,
  kind: customerSources.kind,
  name: customerSources.name,
  selector: customerSources.selector,
  createdAt: customerSources.createdAt,
  lastSyncStatus: customerSources.lastSyncStatus,
  lastSyncStartedAt: customerSources.lastSyncStartedAt,
  lastSyncedAt: customerSources.lastSyncedAt,
  lastSyncItemCount: customerSources.lastSyncItemCount,
  lastSyncError: customerSources.lastSyncError,
};

export function isCustomerSourceKind(
  value: unknown,
): value is CustomerSourceKind {
  return CUSTOMER_SOURCE_KINDS.includes(value as CustomerSourceKind);
}

async function ownsCustomer(
  organizationId: string,
  customerId: string,
): Promise<boolean> {
  const customer = await getCustomer(organizationId, customerId);
  return customer?.status === "active";
}

/** The customer's selected sources, or null if the customer is not theirs. */
export async function listCustomerSources(
  organizationId: string,
  customerId: string,
): Promise<CustomerSourceSummary[] | null> {
  if (!(await ownsCustomer(organizationId, customerId))) return null;
  return getControlPlaneDb()
    .select(summary)
    .from(customerSources)
    .where(eq(customerSources.customerId, customerId))
    .orderBy(customerSources.kind, customerSources.name);
}

/**
 * What one of the organisation's connections offers for a source kind
 * (Gmail labels, Drive folders…). Calls the provider.
 *
 * @throws IntegrationError
 */
export async function listAvailableSources(
  organizationId: string,
  connectionId: string,
  kind: CustomerSourceKind,
): Promise<IntegrationSource[]> {
  const fresh = await getFreshIntegrationTokens(organizationId, connectionId);
  if (!fresh) throw new IntegrationError("Connection not found.", 404);
  const adapter = resolveAdapter(fresh.provider);
  if (!adapter) throw new IntegrationError("Integration is not configured.");
  if (!adapter.sourceKinds.includes(kind)) return [];
  return adapter.listSources(fresh.tokens, kind);
}

async function insert(
  customerId: string,
  connectionId: string,
  source: Pick<IntegrationSource, "kind" | "name" | "selector">,
): Promise<CustomerSourceSummary> {
  const db = getControlPlaneDb();
  const existing = await db
    .select(summary)
    .from(customerSources)
    .where(
      and(
        eq(customerSources.customerId, customerId),
        eq(customerSources.connectionId, connectionId),
        eq(customerSources.kind, source.kind),
      ),
    );
  const wanted = JSON.stringify(source.selector);
  const duplicate = existing.find(
    (row) => JSON.stringify(row.selector) === wanted,
  );
  if (duplicate) return duplicate;
  const [created] = await db
    .insert(customerSources)
    // Field by field: `source` may carry the provider's own `id`.
    .values({
      customerId,
      connectionId,
      kind: source.kind,
      name: source.name,
      selector: source.selector,
    })
    .returning(summary);
  return created;
}

async function ownsConnection(
  organizationId: string,
  connectionId: string,
): Promise<boolean> {
  if (!isUuid(connectionId)) return false;
  const rows = await getControlPlaneDb()
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.id, connectionId),
        eq(integrationConnections.organizationId, organizationId),
      ),
    );
  return rows.length > 0;
}

/**
 * Selects one of the provider's sources for a customer. The source is looked
 * up at the provider by id — its name and selector are never taken from the
 * browser. Returns null if the customer or connection is not theirs.
 *
 * @throws ValidationError, IntegrationError
 */
export async function addCustomerSource(
  organizationId: string,
  customerId: string,
  input: { connectionId: string; kind: unknown; sourceId: unknown },
): Promise<CustomerSourceSummary | null> {
  if (!isCustomerSourceKind(input.kind)) {
    throw new ValidationError("Unknown source type.");
  }
  if (!(await ownsCustomer(organizationId, customerId))) return null;
  if (!(await ownsConnection(organizationId, input.connectionId))) return null;

  const available = await listAvailableSources(
    organizationId,
    input.connectionId,
    input.kind,
  );
  const source = available.find((candidate) => candidate.id === input.sourceId);
  if (!source) throw new ValidationError("Choose a source from the list.");
  return insert(customerId, input.connectionId, source);
}

export const GMAIL_QUERY_MAX_LENGTH = 300;

/**
 * Selects Gmail messages matching a search query (e.g. `from:acme.com`) for
 * a customer. Returns null if the customer or connection is not theirs.
 *
 * @throws ValidationError
 */
export async function addGmailQuerySource(
  organizationId: string,
  customerId: string,
  input: { connectionId: string; query: unknown },
): Promise<CustomerSourceSummary | null> {
  const query = requiredText(input.query, "Search", GMAIL_QUERY_MAX_LENGTH);
  if (!(await ownsCustomer(organizationId, customerId))) return null;
  if (!(await ownsConnection(organizationId, input.connectionId))) return null;
  return insert(customerId, input.connectionId, {
    kind: "gmail",
    name: `Search: ${query}`,
    selector: { query },
  });
}

/** Deselects a source. Returns false if it is not the customer's or theirs. */
export async function removeCustomerSource(
  organizationId: string,
  customerId: string,
  sourceId: string,
): Promise<boolean> {
  if (!isUuid(sourceId)) return false;
  if (!(await ownsCustomer(organizationId, customerId))) return false;
  const deleted = await getControlPlaneDb()
    .delete(customerSources)
    .where(
      and(
        eq(customerSources.id, sourceId),
        eq(customerSources.customerId, customerId),
      ),
    )
    .returning({ id: customerSources.id });
  return deleted.length > 0;
}
