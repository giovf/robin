import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { PhaseSelector } from "@/components/phase-selector";
import { cardClass } from "@/components/ui";
import { requireSolution } from "@/lib/hub";
import {
  SOLUTION_DESCRIPTION_MAX_LENGTH,
  SOLUTION_NAME_MAX_LENGTH,
} from "@/lib/solutions";

import {
  setSolutionPhaseAction,
  setSolutionStatusAction,
  updateSolutionAction,
} from "../actions";

export const metadata: Metadata = { title: "Solution" };

export default async function SolutionOverviewPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]">) {
  const { customerId, solutionId } = await params;
  const { solution } = await requireSolution(customerId, solutionId);
  const setStatus = setSolutionStatusAction.bind(null, customerId, solution.id);
  const section = `${cardClass} flex flex-col gap-4 p-6`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="details-heading" className={section}>
        <h3 id="details-heading" className="text-base font-semibold">
          Details
        </h3>
        <ActionForm
          key={`${solution.name}|${solution.description}`}
          action={updateSolutionAction.bind(null, customerId, solution.id)}
          submitLabel="Save"
        >
          <TextField
            name="name"
            label="Name"
            defaultValue={solution.name}
            required
            maxLength={SOLUTION_NAME_MAX_LENGTH}
          />
          <TextField
            name="description"
            label="Description"
            defaultValue={solution.description ?? ""}
            multiline
            maxLength={SOLUTION_DESCRIPTION_MAX_LENGTH}
          />
        </ActionForm>
      </section>

      <section aria-labelledby="phase-heading" className={section}>
        <h3 id="phase-heading" className="text-base font-semibold">
          Life-cycle phase
        </h3>
        <PhaseSelector
          currentPhase={solution.currentPhase}
          action={setSolutionPhaseAction.bind(null, customerId, solution.id)}
        />
      </section>

      <section
        aria-labelledby="status-heading"
        className={`${section} lg:col-span-2`}
      >
        <h3 id="status-heading" className="text-base font-semibold">
          Status
        </h3>
        <div className="flex flex-wrap gap-3">
          {solution.status === "active" ? (
            <ActionForm action={setStatus} submitLabel="Mark as going ahead">
              <input type="hidden" name="status" value="going_ahead" />
            </ActionForm>
          ) : null}
          {solution.status === "going_ahead" ? (
            <ActionForm action={setStatus} submitLabel="Mark as completed">
              <input type="hidden" name="status" value="completed" />
            </ActionForm>
          ) : null}
          {solution.status === "archived" ? (
            <ActionForm
              action={setStatus}
              submitLabel="Restore solution"
              variant="secondary"
            >
              <input type="hidden" name="status" value="active" />
            </ActionForm>
          ) : (
            <ActionForm
              action={setStatus}
              submitLabel="Archive solution"
              variant="danger"
            >
              <input type="hidden" name="status" value="archived" />
            </ActionForm>
          )}
        </div>
      </section>
    </div>
  );
}
