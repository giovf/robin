import Link from "next/link";

import type { Solution } from "@/db/customer/schema";
import { formatDate } from "@/lib/hub";
import { phaseLabel } from "@/lib/phases";

import { cardClass } from "./ui";

export const SOLUTION_STATUS_LABELS: Record<Solution["status"], string> = {
  active: "Exploring",
  going_ahead: "Going ahead",
  completed: "Completed",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: Solution["status"] }) {
  const tone =
    status === "going_ahead" || status === "completed"
      ? "bg-success-soft text-success"
      : "bg-sunken text-muted";
  return (
    <span
      className={`${tone} rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap`}
    >
      {SOLUTION_STATUS_LABELS[status]}
    </span>
  );
}

interface SolutionCardProps {
  customerId: string;
  solution: Solution;
}

export function SolutionCard({ customerId, solution }: SolutionCardProps) {
  return (
    <Link
      href={`/customers/${customerId}/solutions/${solution.id}`}
      className={`${cardClass} hover:border-accent flex h-full flex-col gap-3 p-4 transition-colors`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold">{solution.name}</h3>
        <StatusBadge status={solution.status} />
      </div>
      {solution.description ? (
        <p className="text-muted line-clamp-2 text-sm">
          {solution.description}
        </p>
      ) : null}
      <p className="text-muted mt-auto text-xs">
        {phaseLabel(solution.currentPhase)} · updated{" "}
        {formatDate(solution.updatedAt)}
      </p>
    </Link>
  );
}
