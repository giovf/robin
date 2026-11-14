import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { requireSolution } from "@/lib/hub";

export const metadata: Metadata = { title: "Documents" };

export default async function SolutionDocumentsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents">) {
  const { customerId, solutionId } = await params;
  await requireSolution(customerId, solutionId);
  return (
    <>
      <PageHeader
        as="h3"
        title="Documents"
        description="Generated and edited documents for this solution."
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>No documents yet.</p>
    </>
  );
}
