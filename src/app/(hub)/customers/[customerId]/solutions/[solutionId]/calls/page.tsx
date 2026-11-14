import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { requireSolution } from "@/lib/hub";

export const metadata: Metadata = { title: "Calls" };

export default async function SolutionCallsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/calls">) {
  const { customerId, solutionId } = await params;
  await requireSolution(customerId, solutionId);
  return (
    <>
      <PageHeader
        as="h3"
        title="Calls"
        description="Call sessions for this solution will appear here."
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>No calls yet.</p>
    </>
  );
}
