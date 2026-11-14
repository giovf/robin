import { StatusBadge } from "@/components/solution-card";
import { Tabs } from "@/components/tabs";
import { requireSolution } from "@/lib/hub";
import { phaseLabel } from "@/lib/phases";

export default async function SolutionLayout({
  children,
  params,
}: LayoutProps<"/customers/[customerId]/solutions/[solutionId]">) {
  const { customerId, solutionId } = await params;
  const { solution } = await requireSolution(customerId, solutionId);
  const base = `/customers/${customerId}/solutions/${solution.id}`;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">
            {solution.name}
          </h2>
          <StatusBadge status={solution.status} />
          <span className="text-muted text-sm">
            Phase: {phaseLabel(solution.currentPhase)}
          </span>
        </div>
        <Tabs
          label="Solution sections"
          items={[
            { href: base, label: "Overview" },
            { href: `${base}/calls`, label: "Calls" },
            { href: `${base}/documents`, label: "Documents" },
            { href: `${base}/diagrams`, label: "Diagrams" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
