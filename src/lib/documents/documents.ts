import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";

import { isUuid } from "@/db/customer/database-url";
import {
  calls,
  documents,
  documentVersions,
  publications,
  sourceItems,
  type DocumentCitation,
  type DocumentRecord,
  type DocumentVersion,
  type Publication,
} from "@/db/customer/schema";

import { getCustomerAgent } from "../agent/customer-agent";
import { getCustomerConnection, type CustomerDb } from "../customer-connection";
import {
  getFreshIntegrationTokens,
  IntegrationError,
  resolveAdapter,
} from "../integrations";
import type { CurrentUser } from "../session";
import { getSolution } from "../solutions";
import { requiredText, ValidationError } from "../validation";
import { markdownToXhtml } from "./markdown";
import { getDocumentTemplate } from "./templates";

export const DOCUMENT_TITLE_MAX_LENGTH = 160;
export const DOCUMENT_MAX_LENGTH = 200_000;

export interface DocumentSummary extends DocumentRecord {
  latestVersion: number;
}

async function latestVersionNumber(
  db: Pick<CustomerDb, "select">,
  documentId: string,
): Promise<number> {
  const [row] = await db
    .select({ value: max(documentVersions.version) })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId));
  return row?.value ?? 0;
}

async function findDocument(
  db: CustomerDb,
  documentId: string,
): Promise<DocumentRecord | null> {
  if (!isUuid(documentId)) return null;
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  return document ?? null;
}

export async function listDocuments(
  userId: string,
  customerId: string,
  solutionId: string,
): Promise<DocumentSummary[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(solutionId)) return [];
  const rows = await db
    .select({
      document: documents,
      latestVersion:
        sql<number>`coalesce(max(${documentVersions.version}), 0)`.mapWith(
          Number,
        ),
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(eq(documents.solutionId, solutionId))
    .groupBy(documents.id)
    .orderBy(desc(documents.updatedAt));
  return rows.map((row) => ({
    ...row.document,
    latestVersion: row.latestVersion,
  }));
}

/**
 * Has the customer's agent draft a document from a template and stores it as
 * version 1. `onText` receives the draft as it is written. Nothing is stored
 * if drafting fails.
 *
 * @throws ValidationError, LlmError, CustomerConnectionError
 */
export async function generateDocument(
  userId: string,
  customerId: string,
  input: { solutionId: string; templateId: unknown },
  onText?: (delta: string) => void,
): Promise<DocumentSummary> {
  const template = getDocumentTemplate(input.templateId);
  if (!template) throw new ValidationError("Choose a document template.");
  const agent = await getCustomerAgent(userId, customerId);
  const draft = await agent.draftDocument(
    {
      solutionId: input.solutionId,
      title: template.name,
      brief: template.brief,
    },
    onText,
  );
  if (!draft.content) throw new ValidationError("The draft came back empty.");

  const db = await getCustomerConnection(userId, customerId);
  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(documents)
      .values({
        solutionId: input.solutionId,
        templateId: template.id,
        phase: template.phase,
        title: template.name,
      })
      .returning();
    await tx.insert(documentVersions).values({
      documentId: document.id,
      version: 1,
      content: draft.content,
      citations: draft.citations,
      createdBy: "agent",
    });
    return { ...document, latestVersion: 1 };
  });
}

export interface CitedSource {
  /** The marker used in the text, e.g. `S2`. */
  marker: string;
  title: string;
  /** Link target inside the hub, when the source still exists. */
  sourceItemId: string | null;
  callId: string | null;
}

export interface DocumentDetail {
  document: DocumentRecord;
  /** The version being viewed. */
  version: DocumentVersion;
  latestVersion: number;
  sources: CitedSource[];
}

async function resolveSources(
  db: CustomerDb,
  citations: DocumentCitation[],
): Promise<CitedSource[]> {
  const itemIds = citations.flatMap((c) =>
    c.sourceItemId ? [c.sourceItemId] : [],
  );
  const callIds = citations.flatMap((c) => (c.callId ? [c.callId] : []));
  const items = itemIds.length
    ? await db
        .select({ id: sourceItems.id, title: sourceItems.title })
        .from(sourceItems)
        .where(inArray(sourceItems.id, itemIds))
    : [];
  const callRows = callIds.length
    ? await db
        .select({ id: calls.id, title: calls.title })
        .from(calls)
        .where(inArray(calls.id, callIds))
    : [];
  return citations.map((citation) => {
    const item = items.find((row) => row.id === citation.sourceItemId);
    const call = callRows.find((row) => row.id === citation.callId);
    return {
      marker: citation.location ?? "",
      title: item
        ? item.title
        : call
          ? `Call: ${call.title ?? "untitled"}`
          : "Source no longer in the context",
      sourceItemId: item?.id ?? null,
      callId: call?.id ?? null,
    };
  });
}

/** A document at its latest version, or at `version` if given. */
export async function getDocument(
  userId: string,
  customerId: string,
  documentId: string,
  version?: number,
): Promise<DocumentDetail | null> {
  const db = await getCustomerConnection(userId, customerId);
  const document = await findDocument(db, documentId);
  if (!document) return null;
  const latestVersion = await latestVersionNumber(db, document.id);
  const wanted =
    version !== undefined && Number.isInteger(version)
      ? version
      : latestVersion;
  const [row] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, document.id),
        eq(documentVersions.version, wanted),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    document,
    version: row,
    latestVersion,
    sources: await resolveSources(db, row.citations),
  };
}

export async function listDocumentVersions(
  userId: string,
  customerId: string,
  documentId: string,
): Promise<Pick<DocumentVersion, "version" | "createdBy" | "createdAt">[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(documentId)) return [];
  return db
    .select({
      version: documentVersions.version,
      createdBy: documentVersions.createdBy,
      createdAt: documentVersions.createdAt,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version));
}

/**
 * Saves an edit as a new version (earlier versions are never changed).
 * Saving unchanged content and title does nothing. Returns the resulting
 * latest version number, or null if the document does not exist.
 *
 * @throws ValidationError
 */
export async function saveDocument(
  userId: string,
  customerId: string,
  documentId: string,
  input: { title: unknown; content: unknown },
): Promise<number | null> {
  const title = requiredText(input.title, "Title", DOCUMENT_TITLE_MAX_LENGTH);
  const content =
    typeof input.content === "string"
      ? input.content.replace(/\r\n?/g, "\n")
      : "";
  if (!content.trim()) throw new ValidationError("The document is empty.");
  if (content.length > DOCUMENT_MAX_LENGTH) {
    throw new ValidationError("The document is too long.");
  }
  const db = await getCustomerConnection(userId, customerId);
  const document = await findDocument(db, documentId);
  if (!document) return null;

  return db.transaction(async (tx) => {
    // Serialise concurrent saves so version numbers stay unique.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${document.id}))`,
    );
    const [latest] = await tx
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
      .orderBy(desc(documentVersions.version))
      .limit(1);
    if (title !== document.title) {
      await tx
        .update(documents)
        .set({ title })
        .where(eq(documents.id, document.id));
    }
    if (latest && latest.content === content) return latest.version;
    const version = (latest?.version ?? 0) + 1;
    await tx.insert(documentVersions).values({
      documentId: document.id,
      version,
      content,
      // Markers the edit kept still point at the same sources.
      citations: latest?.citations ?? [],
      createdBy: userId,
    });
    await tx
      .update(documents)
      .set({ updatedAt: new Date() })
      .where(eq(documents.id, document.id));
    return version;
  });
}

/** Makes an earlier version current again, as a new version. */
export async function restoreDocumentVersion(
  userId: string,
  customerId: string,
  documentId: string,
  version: number,
): Promise<number | null> {
  const old = await getDocument(userId, customerId, documentId, version);
  if (!old) return null;
  return saveDocument(userId, customerId, documentId, {
    title: old.document.title,
    content: old.version.content,
  });
}

export async function deleteDocument(
  userId: string,
  customerId: string,
  documentId: string,
): Promise<boolean> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(documentId)) return false;
  const deleted = await db
    .delete(documents)
    .where(eq(documents.id, documentId))
    .returning({ id: documents.id });
  return deleted.length > 0;
}

// ── Publishing ─────────────────────────────────────────────────────────────

export async function listPublications(
  userId: string,
  customerId: string,
  documentId: string,
): Promise<Publication[]> {
  const db = await getCustomerConnection(userId, customerId);
  if (!isUuid(documentId)) return [];
  return db
    .select()
    .from(publications)
    .where(eq(publications.documentId, documentId))
    .orderBy(asc(publications.createdAt));
}

export interface PublishInput {
  documentId: string;
  /** The version the user reviewed; publishing fails if it is no longer the latest. */
  reviewedVersion: number;
  /** The organisation's Atlassian connection to publish through. */
  connectionId: string;
  /** Id of a Confluence space offered by that connection (`<cloudId>:<key>`). */
  spaceId: unknown;
  pageTitle: unknown;
  /** The user ticked "I have reviewed this and want it published". */
  confirmed: boolean;
}

/**
 * Publishes the latest version of a document as a new Confluence page.
 *
 * WRITES TO THE CUSTOMER'S SYSTEM. It runs only when the user has confirmed,
 * and only for the exact version they reviewed. Every publication is recorded
 * in the customer's `publications` audit log.
 *
 * @throws ValidationError, IntegrationError, CustomerConnectionError
 */
export async function publishDocumentToConfluence(
  user: Pick<CurrentUser, "id" | "organizationId">,
  customerId: string,
  input: PublishInput,
): Promise<Publication> {
  if (input.confirmed !== true) {
    throw new ValidationError(
      "Confirm that you have reviewed the document before publishing.",
    );
  }
  const pageTitle = requiredText(input.pageTitle, "Page title", 255);
  const detail = await getDocument(user.id, customerId, input.documentId);
  if (!detail) throw new ValidationError("This document no longer exists.");
  if (detail.version.version !== input.reviewedVersion) {
    throw new ValidationError(
      "The document changed since you reviewed it. Review the latest version and confirm again.",
    );
  }

  const fresh = await getFreshIntegrationTokens(
    user.organizationId,
    input.connectionId,
  );
  if (!fresh || fresh.provider !== "atlassian") {
    throw new ValidationError("Choose an Atlassian connection.");
  }
  const adapter = resolveAdapter("atlassian");
  if (!adapter?.publish) {
    throw new IntegrationError("The Atlassian integration is not configured.");
  }
  // The space is looked up at the provider: its key never comes from the browser.
  const spaces = await adapter.listSources(fresh.tokens, "confluence");
  const space = spaces.find((candidate) => candidate.id === input.spaceId);
  if (!space)
    throw new ValidationError("Choose a Confluence space from the list.");

  const result = await adapter.publish(fresh.tokens, {
    target: { kind: "confluence", ...space.selector },
    title: pageTitle,
    body: detail.version.content,
    bodyHtml: markdownToXhtml(detail.version.content),
  });

  const db = await getCustomerConnection(user.id, customerId);
  const [publication] = await db
    .insert(publications)
    .values({
      documentId: detail.document.id,
      version: detail.version.version,
      destination: "confluence",
      targetLabel: space.name,
      externalId: result.externalId,
      url: result.url,
      publishedBy: user.id,
    })
    .returning();
  return publication;
}

/** Whether the solution a document belongs to is the one in the URL. */
export async function documentBelongsToSolution(
  userId: string,
  customerId: string,
  documentId: string,
  solutionId: string,
): Promise<boolean> {
  const db = await getCustomerConnection(userId, customerId);
  const document = await findDocument(db, documentId);
  const solution = await getSolution(userId, customerId, solutionId);
  return Boolean(document && solution && document.solutionId === solution.id);
}
