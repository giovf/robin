import { and, eq } from "drizzle-orm";

import { getControlPlaneDb } from "@/db/control-plane/connection";
import { customerSources } from "@/db/control-plane/schema";
import { isUuid } from "@/db/customer/database-url";

import { getCustomerConnection } from "../customer-connection";
import {
  getFreshIntegrationTokens,
  IntegrationError,
  resolveAdapter,
} from "../integrations";
import type { CurrentUser } from "../session";
import { ingestItem } from "./ingest";

/** Safety cap on pages fetched in one sync. */
const MAX_PAGES = 40;
/** A sync still "running" after this long is considered dead. */
const STALE_RUN_MS = 15 * 60_000;

export interface SyncResult {
  status: "ok" | "error" | "already_running" | "not_found";
  /** Items seen at the provider. */
  itemCount: number;
  /** Items that were new or had changed, and were (re)ingested. */
  changedCount: number;
  error?: string;
}

type Actor = Pick<CurrentUser, "id" | "organizationId">;

async function finish(
  sourceId: string,
  values: Partial<typeof customerSources.$inferInsert>,
): Promise<void> {
  await getControlPlaneDb()
    .update(customerSources)
    .set(values)
    .where(eq(customerSources.id, sourceId));
}

/**
 * Pulls one selected source (a Gmail label, Drive folder, Confluence space,
 * Jira project…) into the customer's context: fetches it page by page and
 * ingests every item, skipping unchanged ones.
 *
 * Content flows provider → that customer's database only. The control plane
 * records just the status, a count and a generic error.
 *
 * Items deleted at the provider are not removed here.
 *
 * @throws CustomerConnectionError if the user may not access the customer.
 */
export async function syncCustomerSource(
  user: Actor,
  customerId: string,
  sourceId: string,
): Promise<SyncResult> {
  const none = { itemCount: 0, changedCount: 0 };
  // The resolver is the ownership check for the customer.
  const db = await getCustomerConnection(user.id, customerId);
  if (!isUuid(sourceId)) return { status: "not_found", ...none };

  const [source] = await getControlPlaneDb()
    .select()
    .from(customerSources)
    .where(
      and(
        eq(customerSources.id, sourceId),
        eq(customerSources.customerId, customerId),
      ),
    )
    .limit(1);
  if (!source) return { status: "not_found", ...none };

  const startedAt = new Date();
  if (
    source.lastSyncStatus === "running" &&
    source.lastSyncStartedAt &&
    startedAt.getTime() - source.lastSyncStartedAt.getTime() < STALE_RUN_MS
  ) {
    return { status: "already_running", ...none };
  }
  await finish(source.id, {
    lastSyncStatus: "running",
    lastSyncStartedAt: startedAt,
    lastSyncError: null,
  });

  let itemCount = 0;
  let changedCount = 0;
  try {
    const fresh = await getFreshIntegrationTokens(
      user.organizationId,
      source.connectionId,
    );
    if (!fresh) throw new IntegrationError("Connection not found.", 404);
    const adapter = resolveAdapter(fresh.provider);
    if (!adapter) throw new IntegrationError("Integration is not configured.");

    let pageToken: string | undefined;
    let pages = 0;
    do {
      const page = await adapter.fetchContent(
        fresh.tokens,
        { kind: source.kind, selector: source.selector },
        pageToken,
      );
      for (const item of page.items) {
        itemCount += 1;
        if (!item.text.trim()) continue;
        const result = await ingestItem(db, {
          provider: source.kind,
          externalId: item.externalId,
          title: item.title,
          url: item.url,
          text: item.text,
          customerSourceId: source.id,
        });
        if (result.changed) changedCount += 1;
      }
      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken && pages < MAX_PAGES);

    await finish(source.id, {
      lastSyncStatus: "ok",
      lastSyncedAt: new Date(),
      lastSyncItemCount: itemCount,
    });
    return { status: "ok", itemCount, changedCount };
  } catch (error) {
    // Deliberately generic: provider errors can quote customer content.
    const message =
      error instanceof IntegrationError
        ? error.needsReauth
          ? "The account needs reconnecting."
          : "The provider could not be reached."
        : "The sync failed unexpectedly.";
    await finish(source.id, {
      lastSyncStatus: "error",
      lastSyncItemCount: itemCount,
      lastSyncError: message,
    });
    if (!(error instanceof IntegrationError)) {
      console.error(`Sync of customer source ${source.id} failed`, error);
    }
    return { status: "error", itemCount, changedCount, error: message };
  }
}
