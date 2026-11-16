import type { Metadata } from "next";
import Link from "next/link";

import { DocumentOutline } from "@/components/document-outline";
import { Markdown } from "@/components/markdown";
import { MermaidView } from "@/components/mermaid-view";
import { PageHeader } from "@/components/page-header";
import { cardClass, linkClass, secondaryButtonClass } from "@/components/ui";
import { getDiagram } from "@/lib/diagrams";
import { getDocument } from "@/lib/documents/documents";
import {
  listCustomerLibrary,
  type LibrarySolution,
} from "@/lib/documents/library";
import { documentOutline } from "@/lib/documents/outline";
import { formatDate, orNotFound, requireCustomer } from "@/lib/hub";
import { phaseLabel } from "@/lib/phases";

export const metadata: Metadata = { title: "Documents" };

type Selection = { kind: "document" | "diagram"; id: string } | null;

/** The item named in the URL, else the first document, else the first diagram. */
function pickSelection(
  library: LibrarySolution[],
  query: { doc?: unknown; diagram?: unknown },
): Selection {
  const documentIds = library.flatMap((s) => s.documents.map((d) => d.id));
  const diagramIds = library.flatMap((s) => s.diagrams.map((d) => d.id));
  if (typeof query.doc === "string" && documentIds.includes(query.doc)) {
    return { kind: "document", id: query.doc };
  }
  if (typeof query.diagram === "string" && diagramIds.includes(query.diagram)) {
    return { kind: "diagram", id: query.diagram };
  }
  if (documentIds.length) return { kind: "document", id: documentIds[0] };
  if (diagramIds.length) return { kind: "diagram", id: diagramIds[0] };
  return null;
}

const itemClass = (current: boolean): string =>
  `rounded-control flex flex-col gap-0.5 px-3 py-2 text-sm ${
    current ? "bg-accent-soft text-accent" : "hover:bg-sunken"
  }`;

async function DocumentPreview({
  userId,
  customerId,
  documentId,
}: {
  userId: string;
  customerId: string;
  documentId: string;
}) {
  const detail = await getDocument(userId, customerId, documentId);
  if (!detail) return null;
  const { document, version } = detail;
  const href = `/customers/${customerId}/solutions/${document.solutionId}/documents/${document.id}`;
  const outline = documentOutline(version.content);
  return (
    <article
      aria-labelledby="preview-title"
      className={`${cardClass} flex min-w-0 flex-col gap-5 p-6`}
    >
      <header className="border-line flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h3 id="preview-title" className="text-lg font-semibold">
            {document.title}
          </h3>
          <p className="text-muted mt-1 text-sm">
            {document.phase ? `${phaseLabel(document.phase)} · ` : ""}
            version {version.version} · updated {formatDate(document.updatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={href} className={secondaryButtonClass}>
            Open
          </Link>
          <Link href={`${href}/edit`} className={secondaryButtonClass}>
            Edit
          </Link>
        </div>
      </header>
      {outline.length > 1 ? (
        <details className="text-sm">
          <summary className="text-muted cursor-pointer font-medium">
            Outline ({outline.length} sections)
          </summary>
          <div className="mt-3">
            <DocumentOutline entries={outline} />
          </div>
        </details>
      ) : null}
      <Markdown headingIds>{version.content}</Markdown>
    </article>
  );
}

async function DiagramPreview({
  userId,
  customerId,
  diagramId,
}: {
  userId: string;
  customerId: string;
  diagramId: string;
}) {
  const diagram = await getDiagram(userId, customerId, diagramId);
  if (!diagram) return null;
  const href = `/customers/${customerId}/solutions/${diagram.solutionId}/diagrams/${diagram.id}`;
  return (
    <article
      aria-labelledby="preview-title"
      className={`${cardClass} flex min-w-0 flex-col gap-5 p-6`}
    >
      <header className="border-line flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h3 id="preview-title" className="text-lg font-semibold">
            {diagram.title}
          </h3>
          <p className="text-muted mt-1 text-sm">
            Diagram · updated {formatDate(diagram.updatedAt)}
          </p>
        </div>
        <Link href={href} className={secondaryButtonClass}>
          Open and edit
        </Link>
      </header>
      <div className="rounded-control flex min-h-64 items-center justify-center overflow-auto bg-white p-4">
        <MermaidView
          key={diagram.id}
          source={diagram.sourceCode}
          label={`Diagram: ${diagram.title}`}
        />
      </div>
    </article>
  );
}

export default async function CustomerDocumentsPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/documents">) {
  const { customerId } = await params;
  const { user, customer } = await requireCustomer(customerId);
  const library = await orNotFound(() =>
    listCustomerLibrary(user.id, customerId),
  );
  const selection = pickSelection(library, await searchParams);
  const base = `/customers/${customerId}`;

  return (
    <>
      <PageHeader
        as="h2"
        title="Documents"
        description={`Everything Robin has drafted for ${customer.name}, across all solutions. Pick one to read it here.`}
      />
      {selection ? (
        <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <nav
            aria-label="Documents and diagrams"
            className="flex flex-col gap-5 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto"
          >
            {library.map((solution) => (
              <section
                key={solution.id}
                aria-labelledby={`library-${solution.id}`}
              >
                <h3
                  id={`library-${solution.id}`}
                  className="text-muted px-3 text-xs font-semibold tracking-wide uppercase"
                >
                  <Link
                    href={`${base}/solutions/${solution.id}/documents`}
                    className="hover:text-ink"
                  >
                    {solution.name}
                  </Link>
                </h3>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {solution.documents.map((document) => {
                    const current =
                      selection.kind === "document" &&
                      selection.id === document.id;
                    return (
                      <li key={document.id}>
                        <Link
                          href={`${base}/documents?doc=${document.id}`}
                          scroll={false}
                          aria-current={current ? "true" : undefined}
                          className={itemClass(current)}
                        >
                          <span className="font-medium">{document.title}</span>
                          <span className="text-muted text-xs">
                            {document.phase
                              ? `${phaseLabel(document.phase)} · `
                              : ""}
                            v{document.latestVersion} ·{" "}
                            {formatDate(document.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {solution.diagrams.map((diagram) => {
                    const current =
                      selection.kind === "diagram" &&
                      selection.id === diagram.id;
                    return (
                      <li key={diagram.id}>
                        <Link
                          href={`${base}/documents?diagram=${diagram.id}`}
                          scroll={false}
                          aria-current={current ? "true" : undefined}
                          className={itemClass(current)}
                        >
                          <span className="font-medium">{diagram.title}</span>
                          <span className="text-muted text-xs">
                            Diagram · {formatDate(diagram.updatedAt)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </nav>
          {selection.kind === "document" ? (
            <DocumentPreview
              userId={user.id}
              customerId={customerId}
              documentId={selection.id}
            />
          ) : (
            <DiagramPreview
              userId={user.id}
              customerId={customerId}
              diagramId={selection.id}
            />
          )}
        </div>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          Nothing drafted yet. Open a{" "}
          <Link href={`${base}/solutions`} className={linkClass}>
            solution
          </Link>{" "}
          and draft a document or diagram from its tabs.
        </p>
      )}
    </>
  );
}
