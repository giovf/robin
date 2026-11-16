import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { DocumentEditor } from "@/components/document-editor";
import { cardClass, linkClass, secondaryButtonClass } from "@/components/ui";
import {
  DOCUMENT_TITLE_MAX_LENGTH,
  listPublications,
} from "@/lib/documents/documents";
import { requireDocument } from "@/lib/documents/page-context";
import { formatDate } from "@/lib/hub";

import { deleteDocumentAction, saveDocumentAction } from "../actions";

export const metadata: Metadata = { title: "Document" };

/** Only http(s) links are rendered: the URL comes from an external system. */
function safeUrl(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents/[documentId]">) {
  const { customerId, solutionId, documentId } = await params;
  const { user, detail } = await requireDocument(
    customerId,
    solutionId,
    documentId,
  );
  const { published } = await searchParams;
  const { document, version, sources } = detail;
  const base = `/customers/${customerId}/solutions/${solutionId}/documents`;
  const publications = await listPublications(user.id, customerId, document.id);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={base} className="text-muted text-sm underline">
          Documents
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`${base}/${document.id}/versions`}
            className={secondaryButtonClass}
          >
            Version {version.version} · history
          </Link>
          <Link
            href={`${base}/${document.id}/publish`}
            className={secondaryButtonClass}
          >
            Publish to Confluence…
          </Link>
        </div>
      </div>

      {published ? (
        <p
          role="status"
          className="bg-success-soft text-success rounded-control px-3 py-2 text-sm"
        >
          Published to Confluence.
        </p>
      ) : null}

      <DocumentEditor
        key={`${document.id}-${version.version}-${document.title}`}
        title={document.title}
        content={version.content}
        titleMaxLength={DOCUMENT_TITLE_MAX_LENGTH}
        save={saveDocumentAction.bind(null, customerId, document.id)}
      />

      <section
        aria-labelledby="sources-heading"
        className={`${cardClass} flex flex-col gap-3 p-6`}
      >
        <h4 id="sources-heading" className="text-base font-semibold">
          Sources
        </h4>
        {sources.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {sources.map((source) => (
              <li key={source.marker}>
                <span className="font-mono text-xs">[{source.marker}]</span>{" "}
                {source.sourceItemId ? (
                  <Link
                    href={`/customers/${customerId}/knowledge/${source.sourceItemId}`}
                    className={linkClass}
                  >
                    {source.title}
                  </Link>
                ) : (
                  <span className={source.callId ? "" : "text-muted"}>
                    {source.title}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">
            This draft was written without any retrieved context.
          </p>
        )}
      </section>

      {publications.length ? (
        <section
          aria-labelledby="publications-heading"
          className={`${cardClass} flex flex-col gap-3 p-6`}
        >
          <h4 id="publications-heading" className="text-base font-semibold">
            Published
          </h4>
          <ul className="flex flex-col gap-1 text-sm">
            {publications.map((publication) => {
              const url = safeUrl(publication.url);
              return (
                <li key={publication.id}>
                  Version {publication.version} to {publication.targetLabel} on{" "}
                  {formatDate(publication.createdAt)}
                  {url ? (
                    <>
                      {" "}
                      ·{" "}
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                      >
                        Open page
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <ActionForm
        action={deleteDocumentAction.bind(
          null,
          customerId,
          solutionId,
          document.id,
        )}
        submitLabel="Delete document"
        variant="danger"
      />
    </>
  );
}
