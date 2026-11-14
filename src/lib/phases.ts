/**
 * Life-cycle phases a solution moves through, in order.
 *
 * PROVISIONAL: the exact phase list is a PRD open question. Phases are stored
 * as plain text, so changing this list needs no migration — only solutions
 * already in a removed phase would show it as "unknown".
 */
export const SOLUTION_PHASES = [
  { id: "discovery", label: "Discovery" },
  { id: "design", label: "Solution design" },
  { id: "proposal", label: "Proposal" },
  { id: "delivery", label: "Delivery" },
  { id: "handover", label: "Handover" },
  { id: "operations", label: "Operations" },
] as const;

export type SolutionPhaseId = (typeof SOLUTION_PHASES)[number]["id"];

export function isSolutionPhase(value: unknown): value is SolutionPhaseId {
  return SOLUTION_PHASES.some((phase) => phase.id === value);
}

export function phaseLabel(phaseId: string): string {
  return (
    SOLUTION_PHASES.find((phase) => phase.id === phaseId)?.label ?? phaseId
  );
}

/** The phase after `phaseId`, or null at the end (or for an unknown phase). */
export function nextPhase(phaseId: string): SolutionPhaseId | null {
  const index = SOLUTION_PHASES.findIndex((phase) => phase.id === phaseId);
  if (index === -1) return null;
  return SOLUTION_PHASES[index + 1]?.id ?? null;
}
