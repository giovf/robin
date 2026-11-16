import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { DiagramEditor } from "@/components/diagram-editor";
import { DIAGRAM_TITLE_MAX_LENGTH, getDiagram } from "@/lib/diagrams";
import { orNotFound, requireSolution } from "@/lib/hub";

import { deleteDiagramAction, saveDiagramAction } from "../actions";

export const metadata: Metadata = { title: "Diagram" };

export default async function DiagramPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/diagrams/[diagramId]">) {
  const { customerId, solutionId, diagramId } = await params;
  const { user, solution } = await requireSolution(customerId, solutionId);
  const diagram = await orNotFound(() =>
    getDiagram(user.id, customerId, diagramId),
  );
  if (!diagram || diagram.solutionId !== solution.id) notFound();

  return (
    <>
      <div>
        <Link
          href={`/customers/${customerId}/solutions/${solutionId}/diagrams`}
          className="text-muted text-sm underline"
        >
          Diagrams
        </Link>
      </div>
      <DiagramEditor
        key={diagram.id}
        title={diagram.title}
        sourceCode={diagram.sourceCode}
        titleMaxLength={DIAGRAM_TITLE_MAX_LENGTH}
        save={saveDiagramAction.bind(null, customerId, diagram.id)}
      />
      <ActionForm
        action={deleteDiagramAction.bind(
          null,
          customerId,
          solutionId,
          diagram.id,
        )}
        submitLabel="Delete diagram"
        variant="danger"
      />
    </>
  );
}
