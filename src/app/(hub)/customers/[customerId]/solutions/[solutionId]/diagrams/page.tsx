import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { requireSolution } from "@/lib/hub";

export const metadata: Metadata = { title: "Diagrams" };

export default async function SolutionDiagramsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/diagrams">) {
  const { customerId, solutionId } = await params;
  await requireSolution(customerId, solutionId);
  return (
    <>
      <PageHeader
        as="h3"
        title="Diagrams"
        description="Diagrams for this solution, kept as diagram-as-code."
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>No diagrams yet.</p>
    </>
  );
}
