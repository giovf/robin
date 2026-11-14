import type { FormState } from "@/lib/form-action";
import { nextPhase, phaseLabel, SOLUTION_PHASES } from "@/lib/phases";

import { ActionForm } from "./action-form";
import { Field } from "./field";
import { inputClass } from "./ui";

interface PhaseSelectorProps {
  currentPhase: string;
  /** Server action reading the `phase` form field. */
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}

/** Shows where a solution is in its life cycle and lets the user move it. */
export function PhaseSelector({ currentPhase, action }: PhaseSelectorProps) {
  const currentIndex = SOLUTION_PHASES.findIndex(
    (phase) => phase.id === currentPhase,
  );
  const next = nextPhase(currentPhase);

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap gap-2 text-xs font-medium">
        {SOLUTION_PHASES.map((phase, index) => {
          const isCurrent = index === currentIndex;
          const done = currentIndex > index;
          return (
            <li
              key={phase.id}
              aria-current={isCurrent ? "step" : undefined}
              className={`rounded-full border px-3 py-1 ${
                isCurrent
                  ? "border-accent bg-accent-soft text-accent"
                  : done
                    ? "border-line bg-sunken text-ink"
                    : "border-line text-muted"
              }`}
            >
              <span className="sr-only">
                {isCurrent ? "Current phase: " : done ? "Completed: " : ""}
              </span>
              {index + 1}. {phase.label}
            </li>
          );
        })}
      </ol>

      {next ? (
        <ActionForm
          key={`advance-${currentPhase}`}
          action={action}
          submitLabel={`Advance to ${phaseLabel(next)}`}
        >
          <input type="hidden" name="phase" value={next} />
        </ActionForm>
      ) : null}

      <ActionForm
        key={`set-${currentPhase}`}
        action={action}
        submitLabel="Set phase"
        variant="secondary"
        className="flex flex-wrap items-end gap-3"
      >
        <Field id="phase" label="Or move to a specific phase">
          <select
            id="phase"
            name="phase"
            defaultValue={currentIndex === -1 ? undefined : currentPhase}
            className={inputClass}
          >
            {SOLUTION_PHASES.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.label}
              </option>
            ))}
          </select>
        </Field>
      </ActionForm>
    </div>
  );
}
