import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { cardClass, linkClass } from "@/components/ui";
import { diffLines } from "@/lib/documents/diff";
import { getDocument, listDocumentVersions } from "@/lib/documents/documents";
import { requireDocument } from "@/lib/documents/page-context";
import { formatDate } from "@/lib/hub";

import { restoreDocumentVersionAction } from "../../actions";

export const metadata: Metadata = { title: "Version history" };

export default async function DocumentVersionsPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents/[documentId]/versions">) {
  const { customerId, solutionId, documentId } = await params;
  const { user, detail } = await requireDocument(
    customerId,
    solutionId,
    documentId,
  );
  const query = await searchParams;
  const selected = Number(query.v) || null;
  const base = `/customers/${customerId}/solutions/${solutionId}/documents/${documentId}`;
  const versions = await listDocumentVersions(user.id, customerId, documentId);
  const old =
    selected && selected !== detail.latestVersion
      ? await getDocument(user.id, customerId, documentId, selected)
      : null;
  const diff = old
    ? diffLines(old.version.content, detail.version.content)
    : null;

  return (
    <>
      <div>
        <Link href={base} className="text-muted text-sm underline">
          {detail.document.title}
        </Link>
      </div>
      <PageHeader
        as="h3"
        title="Version history"
        description="Every save is kept. Restoring an old version makes it the newest one; nothing is lost."
      />
      <ul className={`${cardClass} divide-line divide-y`}>
        {versions.map((version) => {
          const current = version.version === detail.latestVersion;
          return (
            <li
              key={version.version}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
            >
              <span>
                <span className="font-medium">Version {version.version}</span>
                {current ? " (current)" : ""}{" "}
                <span className="text-muted">
                  ·{" "}
                  {version.createdBy === "agent"
                    ? "drafted by Robin"
                    : "edited"}{" "}
                  · {formatDate(version.createdAt)}
                </span>
              </span>
              {current ? null : (
                <span className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`${base}?v=${version.version}`}
                    className={linkClass}
                  >
                    Read
                  </Link>
                  <Link
                    href={`${base}/versions?v=${version.version}`}
                    className={linkClass}
                    aria-current={
                      selected === version.version ? "true" : undefined
                    }
                  >
                    Compare with current
                  </Link>
                  <ActionForm
                    action={restoreDocumentVersionAction.bind(
                      null,
                      customerId,
                      solutionId,
                      documentId,
                      version.version,
                    )}
                    submitLabel={`Restore version ${version.version}`}
                    variant="secondary"
                    className="flex flex-col items-end gap-2"
                  />
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {diff && old ? (
        <section aria-labelledby="diff-heading" className="flex flex-col gap-3">
          <h4 id="diff-heading" className="text-base font-semibold">
            From version {old.version.version} to the current version
          </h4>
          <div className={`${cardClass} overflow-x-auto p-4`}>
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">
              {diff.map((line, index) =>
                line.type === "same" ? (
                  <span key={index} className="text-muted block">
                    {"  "}
                    {line.text}
                  </span>
                ) : line.type === "added" ? (
                  <ins
                    key={index}
                    className="bg-success-soft text-success block no-underline"
                  >
                    + {line.text}
                  </ins>
                ) : (
                  <del
                    key={index}
                    className="bg-danger-soft text-danger block no-underline"
                  >
                    - {line.text}
                  </del>
                ),
              )}
            </pre>
          </div>
        </section>
      ) : null}
    </>
  );
}
