/**
 * Life-cycle phases a solution moves through, in order, with the documents
 * expected in each and what the live-call suggestions should focus on.
 *
 * PROVISIONAL: the exact phase list and document set are a PRD open question.
 * Phases are stored as plain text, so changing this list needs no migration —
 * only solutions already in a removed phase would show it as "unknown".
 */
export const SOLUTION_PHASES = [
  {
    id: "discovery",
    label: "Discovery",
    documents: ["discovery-summary", "requirements"],
    suggestionFocus:
      "understanding the business context, current systems, pain points, stakeholders, constraints and what success looks like",
  },
  {
    id: "design",
    label: "Solution design",
    documents: ["solution-architecture", "decision-record"],
    suggestionFocus:
      "architecture options and trade-offs, integration points, non-functional requirements, risks and the decisions that still need an owner",
  },
  {
    id: "proposal",
    label: "Proposal",
    documents: ["proposal"],
    suggestionFocus:
      "scope boundaries, assumptions, commercial constraints, decision process, timeline and what would stop the customer from going ahead",
  },
  {
    id: "delivery",
    label: "Delivery",
    documents: ["delivery-plan"],
    suggestionFocus:
      "progress against the plan, blockers, scope changes, dependencies on the customer and emerging risks",
  },
  {
    id: "handover",
    label: "Handover",
    documents: ["runbook", "handover-guide"],
    suggestionFocus:
      "operational readiness, who will run the solution, training, support arrangements and open defects",
  },
  {
    id: "operations",
    label: "Operations",
    documents: ["operations-review"],
    suggestionFocus:
      "how the solution performs in use, incidents, adoption, costs and improvements worth making",
  },
] as const;

export type SolutionPhaseId = (typeof SOLUTION_PHASES)[number]["id"];

/** The first phase that only happens once the customer has said yes. */
export const FIRST_GOING_AHEAD_PHASE: SolutionPhaseId = "delivery";

export function isSolutionPhase(value: unknown): value is SolutionPhaseId {
  return SOLUTION_PHASES.some((phase) => phase.id === value);
}

function find(phaseId: string) {
  return SOLUTION_PHASES.find((phase) => phase.id === phaseId);
}

export function phaseLabel(phaseId: string): string {
  return find(phaseId)?.label ?? phaseId;
}

/** Template ids of the documents expected in a phase. */
export function phaseDocuments(phaseId: string): readonly string[] {
  return find(phaseId)?.documents ?? [];
}

/** What call suggestions should concentrate on in a phase, if known. */
export function phaseSuggestionFocus(phaseId: string): string | null {
  return find(phaseId)?.suggestionFocus ?? null;
}

/** The phase after `phaseId`, or null at the end (or for an unknown phase). */
export function nextPhase(phaseId: string): SolutionPhaseId | null {
  const index = SOLUTION_PHASES.findIndex((phase) => phase.id === phaseId);
  if (index === -1) return null;
  return SOLUTION_PHASES[index + 1]?.id ?? null;
}

/** Whether a phase comes at or after the customer's go-ahead. */
export function isGoingAheadPhase(phaseId: string): boolean {
  const index = SOLUTION_PHASES.findIndex((phase) => phase.id === phaseId);
  const first = SOLUTION_PHASES.findIndex(
    (phase) => phase.id === FIRST_GOING_AHEAD_PHASE,
  );
  return index !== -1 && index >= first;
}
