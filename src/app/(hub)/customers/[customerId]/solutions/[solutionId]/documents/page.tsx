import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { cardClass, linkClass, primaryButtonClass } from "@/components/ui";
import { listDocuments } from "@/lib/documents/documents";
import { getDocumentTemplate } from "@/lib/documents/templates";
import { formatDate, orNotFound, requireSolution } from "@/lib/hub";
import { phaseDocuments, phaseLabel } from "@/lib/phases";

export const metadata: Metadata = { title: "Documents" };

export default async function SolutionDocumentsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents">) {
  const { customerId, solutionId } = await params;
  const { user, solution } = await requireSolution(customerId, solutionId);
  const base = `/customers/${customerId}/solutions/${solution.id}/documents`;
  const documents = await orNotFound(() =>
    listDocuments(user.id, customerId, solution.id),
  );
  const existing = new Set(documents.map((document) => document.templateId));
  const missing = phaseDocuments(solution.currentPhase)
    .filter((id) => !existing.has(id))
    .flatMap((id) => getDocumentTemplate(id) ?? []);

  return (
    <>
      <PageHeader
        as="h3"
        title="Documents"
        description="Drafted by Robin from this customer's context, then yours to edit. Every save keeps the earlier versions."
        actions={
          <Link href={`${base}/new`} className={primaryButtonClass}>
            New document
          </Link>
        }
      />
      {missing.length ? (
        <section
          aria-labelledby="phase-docs-heading"
          className="bg-accent-soft rounded-card flex flex-col gap-2 p-4 text-sm"
        >
          <h4 id="phase-docs-heading" className="font-semibold">
            Expected in the {phaseLabel(solution.currentPhase)} phase
          </h4>
          <ul className="flex flex-col gap-1">
            {missing.map((template) => (
              <li key={template.id}>
                <Link
                  href={`${base}/new?template=${template.id}`}
                  className={linkClass}
                >
                  Draft the {template.name.toLowerCase()}
                </Link>{" "}
                <span className="text-muted">— {template.summary}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {documents.length ? (
        <ul className={`${cardClass} divide-line divide-y overflow-hidden`}>
          {documents.map((document) => (
            <li key={document.id}>
              <Link
                href={`${base}/${document.id}`}
                className="hover:bg-sunken flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="font-medium">{document.title}</span>
                <span className="text-muted">
                  {document.phase ? `${phaseLabel(document.phase)} · ` : ""}
                  version {document.latestVersion} · updated{" "}
                  {formatDate(document.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No documents yet.
        </p>
      )}
    </>
  );
}
