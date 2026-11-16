import type { Metadata } from "next";

import { GenerateDocument } from "@/components/generate-document";
import { PageHeader } from "@/components/page-header";
import { DOCUMENT_TEMPLATES } from "@/lib/documents/templates";
import { requireSolution } from "@/lib/hub";
import { phaseLabel } from "@/lib/phases";

export const metadata: Metadata = { title: "New document" };

export default async function NewDocumentPage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents/new">) {
  const { customerId, solutionId } = await params;
  const { solution } = await requireSolution(customerId, solutionId);
  const { template } = await searchParams;

  return (
    <>
      <PageHeader
        as="h3"
        title="New document"
        description={`Choose what Robin should draft for ${solution.name}.`}
      />
      <GenerateDocument
        customerId={customerId}
        solutionId={solution.id}
        initialTemplateId={typeof template === "string" ? template : undefined}
        templates={DOCUMENT_TEMPLATES.map((item) => ({
          id: item.id,
          name: item.name,
          summary: item.summary,
          phaseLabel: phaseLabel(item.phase),
          current: item.phase === solution.currentPhase,
        }))}
      />
    </>
  );
}
