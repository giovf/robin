import type { SolutionPhaseId } from "../phases";

export interface DocumentTemplate {
  id: string;
  name: string;
  /** The life-cycle phase this document belongs to. */
  phase: SolutionPhaseId;
  /** One line for the template picker. */
  summary: string;
  /** What the agent is asked to cover. */
  brief: string;
}

/** PROVISIONAL, like the phase list: the document set is a PRD open question. */
export const DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "discovery-summary",
    name: "Discovery summary",
    phase: "discovery",
    summary: "What we learned: context, current state, pain points, goals.",
    brief: `Sections: Business context; Current state (systems, processes, integrations); Pain points; Stakeholders and their concerns; Goals and success criteria; Constraints (time, budget, technology, organisation); Open questions.`,
  },
  {
    id: "requirements",
    name: "Requirements",
    phase: "discovery",
    summary: "Functional and non-functional requirements, prioritised.",
    brief: `Sections: Scope; Functional requirements (numbered, each a single testable statement, with priority Must/Should/Could); Non-functional requirements (performance, availability, security, compliance, operability); Integrations; Assumptions; Out of scope; Open questions.`,
  },
  {
    id: "solution-architecture",
    name: "Solution architecture",
    phase: "design",
    summary: "The proposed architecture and why it fits.",
    brief: `Sections: Summary; Context and drivers; Architecture overview (components and their responsibilities); Data flows and integrations; Technology choices with rationale; How it meets the key non-functional requirements; Security and compliance; Migration approach; Risks and mitigations; Open questions.`,
  },
  {
    id: "decision-record",
    name: "Decision record",
    phase: "design",
    summary: "The significant decisions, options considered and rationale.",
    brief: `One entry per significant decision that the context shows was made or is pending. For each: Title; Status (decided / proposed / open); Context; Options considered with trade-offs; Decision and rationale; Consequences. List decisions still needing an owner at the end.`,
  },
  {
    id: "proposal",
    name: "Proposal",
    phase: "proposal",
    summary: "What we propose to do, for the customer's decision-makers.",
    brief: `Sections: Executive summary; Our understanding of your situation; Proposed solution; Scope and deliverables; Approach and indicative timeline; Assumptions and dependencies on the customer; Risks; What is not included; Next steps. Do not invent prices or dates: where the context gives none, mark them as to be agreed.`,
  },
  {
    id: "delivery-plan",
    name: "Delivery plan",
    phase: "delivery",
    summary: "Workstreams, milestones, dependencies and risks.",
    brief: `Sections: Objectives; Workstreams and what each delivers; Milestones in order (with dates only where the context states them); Roles and responsibilities; Dependencies on the customer and third parties; Risks and mitigations; Governance and reporting; Open questions.`,
  },
  {
    id: "runbook",
    name: "Runbook",
    phase: "handover",
    summary: "How to operate the solution day to day.",
    brief: `Sections: System overview; Environments and access; Routine operations; Monitoring and alerts; Common failures and how to resolve them; Backup and recovery; Escalation contacts (roles, not invented names); Known limitations. Where the context does not describe a procedure, list it under "To be documented".`,
  },
  {
    id: "handover-guide",
    name: "Handover guide",
    phase: "handover",
    summary: "What the receiving team needs to take over.",
    brief: `Sections: What was delivered; What changed from the original plan and why; Architecture in brief; Where things live (repositories, documentation, environments); Outstanding work and known defects; Support arrangements; Recommended next steps.`,
  },
  {
    id: "operations-review",
    name: "Operations review",
    phase: "operations",
    summary: "How the solution is performing and what to improve.",
    brief: `Sections: Summary; Usage and adoption; Reliability and incidents; Performance against the original success criteria; Costs; Feedback from users and stakeholders; Recommended improvements, prioritised; Open questions.`,
  },
];

export function getDocumentTemplate(
  templateId: unknown,
): DocumentTemplate | undefined {
  return DOCUMENT_TEMPLATES.find((template) => template.id === templateId);
}
