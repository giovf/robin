import type { Metadata } from "next";
import Link from "next/link";

import { DocumentOutline } from "@/components/document-outline";
import { Markdown } from "@/components/markdown";
import { PrintButton } from "@/components/print-button";
import {
  cardClass,
  linkClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/ui";
import { listDocuments, listPublications } from "@/lib/documents/documents";
import { documentOutline } from "@/lib/documents/outline";
import { requireDocument } from "@/lib/documents/page-context";
import { formatDate } from "@/lib/hub";
import { isIntegrationEnabled } from "@/lib/integrations";
import { phaseLabel } from "@/lib/phases";

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
  const { published, v } = await searchParams;
  const wanted = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;
  const { user, detail } = await requireDocument(
    customerId,
    solutionId,
    documentId,
    wanted ?? undefined,
  );
  const { document, version, sources, latestVersion } = detail;
  const base = `/customers/${customerId}/solutions/${solutionId}/documents`;
  const href = `${base}/${document.id}`;
  const isLatest = version.version === latestVersion;
  const [publications, siblings] = await Promise.all([
    listPublications(user.id, customerId, document.id),
    listDocuments(user.id, customerId, solutionId),
  ]);
  const position = siblings.findIndex((item) => item.id === document.id);
  const previous = position > 0 ? siblings[position - 1] : null;
  const next =
    position >= 0 && position < siblings.length - 1
      ? siblings[position + 1]
      : null;
  const outline = documentOutline(version.content);
  const canPublish = isIntegrationEnabled("atlassian");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={base} className="text-muted text-sm underline">
          All documents
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href={`${href}/versions`} className={secondaryButtonClass}>
            History
          </Link>
          <a
            href={`/api/customers/${customerId}/documents/${document.id}/download${isLatest ? "" : `?v=${version.version}`}`}
            className={secondaryButtonClass}
          >
            Download
          </a>
          <PrintButton />
          {canPublish && isLatest ? (
            <Link href={`${href}/publish`} className={secondaryButtonClass}>
              Publish to Confluence…
            </Link>
          ) : null}
          {isLatest ? (
            <Link href={`${href}/edit`} className={primaryButtonClass}>
              Edit
            </Link>
          ) : null}
        </div>
      </div>

      {published ? (
        <p
          role="status"
          className="bg-success-soft text-success rounded-control px-3 py-2 text-sm print:hidden"
        >
          Published to Confluence.
        </p>
      ) : null}
      {isLatest ? null : (
        <p
          role="status"
          className="bg-accent-soft rounded-control px-3 py-2 text-sm print:hidden"
        >
          You are reading version {version.version}. The current version is{" "}
          {latestVersion}.{" "}
          <Link href={href} className={linkClass}>
            Read the current version
          </Link>
        </p>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <article
          aria-labelledby="document-title"
          className={`${cardClass} flex min-w-0 flex-col gap-6 p-6 md:p-10 print:border-0 print:p-0`}
        >
          <header className="border-line border-b pb-4">
            <h3
              id="document-title"
              // The text usually opens with its own title; don't show two.
              className={
                /^\s*# /.test(version.content)
                  ? "sr-only"
                  : "text-2xl font-semibold tracking-tight"
              }
            >
              {document.title}
            </h3>
            <p className="text-muted text-sm">
              {document.phase ? `${phaseLabel(document.phase)} · ` : ""}
              version {version.version} ·{" "}
              {version.createdBy === "agent" ? "drafted by Robin" : "edited"} on{" "}
              {formatDate(version.createdAt)}
            </p>
          </header>
          <Markdown headingIds>{version.content}</Markdown>
        </article>
        {outline.length > 1 ? (
          <aside className="order-first lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto print:hidden">
            <DocumentOutline entries={outline} />
          </aside>
        ) : null}
      </div>

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
          className={`${cardClass} flex flex-col gap-3 p-6 print:hidden`}
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

      {previous || next ? (
        <nav
          aria-label="Other documents in this solution"
          className="grid gap-3 sm:grid-cols-2 print:hidden"
        >
          {previous ? (
            <Link
              href={`${base}/${previous.id}`}
              className={`${cardClass} hover:bg-sunken flex flex-col gap-0.5 p-4 text-sm`}
            >
              <span className="text-muted text-xs">Previous</span>
              <span className="font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link
              href={`${base}/${next.id}`}
              className={`${cardClass} hover:bg-sunken flex flex-col gap-0.5 p-4 text-right text-sm`}
            >
              <span className="text-muted text-xs">Next</span>
              <span className="font-medium">{next.title}</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
