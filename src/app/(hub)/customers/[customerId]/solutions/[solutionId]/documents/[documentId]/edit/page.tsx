import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { DocumentEditor } from "@/components/document-editor";
import { DOCUMENT_TITLE_MAX_LENGTH } from "@/lib/documents/documents";
import { requireDocument } from "@/lib/documents/page-context";

import { deleteDocumentAction, saveDocumentAction } from "../../actions";

export const metadata: Metadata = { title: "Edit document" };

export default async function EditDocumentPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents/[documentId]/edit">) {
  const { customerId, solutionId, documentId } = await params;
  const { detail } = await requireDocument(customerId, solutionId, documentId);
  const { document, version } = detail;
  const href = `/customers/${customerId}/solutions/${solutionId}/documents/${document.id}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={href} className="text-muted text-sm underline">
          Back to the document
        </Link>
        <span className="text-muted text-sm">
          Editing version {version.version}
        </span>
      </div>

      <DocumentEditor
        // Keyed by document only: a save must not remount the editor, or its
        // "Saved" confirmation would be lost.
        key={document.id}
        title={document.title}
        content={version.content}
        titleMaxLength={DOCUMENT_TITLE_MAX_LENGTH}
        save={saveDocumentAction.bind(null, customerId, document.id)}
      />

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
