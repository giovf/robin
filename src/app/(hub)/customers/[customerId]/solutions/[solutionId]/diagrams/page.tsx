import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Field, TextField } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { cardClass, inputClass } from "@/components/ui";
import { DIAGRAM_TYPES } from "@/lib/agent/prompts";
import { DIAGRAM_BRIEF_MAX_LENGTH, listDiagrams } from "@/lib/diagrams";
import { formatDate, orNotFound, requireSolution } from "@/lib/hub";

import { generateDiagramAction } from "./actions";

export const metadata: Metadata = { title: "Diagrams" };

export default async function SolutionDiagramsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/diagrams">) {
  const { customerId, solutionId } = await params;
  const { user, solution } = await requireSolution(customerId, solutionId);
  const base = `/customers/${customerId}/solutions/${solution.id}/diagrams`;
  const diagrams = await orNotFound(() =>
    listDiagrams(user.id, customerId, solution.id),
  );

  return (
    <>
      <PageHeader
        as="h3"
        title="Diagrams"
        description="Robin draws diagrams as code (Mermaid) from this customer's context. You can edit the source and export SVG or PNG."
      />
      <section
        aria-labelledby="new-diagram-heading"
        className={`${cardClass} flex max-w-2xl flex-col gap-4 p-6`}
      >
        <h4 id="new-diagram-heading" className="text-base font-semibold">
          New diagram
        </h4>
        <ActionForm
          action={generateDiagramAction.bind(null, customerId, solution.id)}
          submitLabel="Draw with Robin"
        >
          <Field id="type" label="Type">
            <select id="type" name="type" required className={inputClass}>
              {DIAGRAM_TYPES.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
          <TextField
            name="brief"
            label="What should it show?"
            hint="Optional, e.g. “current order flow from web shop to finance”."
            maxLength={DIAGRAM_BRIEF_MAX_LENGTH}
          />
        </ActionForm>
      </section>
      {diagrams.length ? (
        <ul className={`${cardClass} divide-line divide-y overflow-hidden`}>
          {diagrams.map((diagram) => (
            <li key={diagram.id}>
              <Link
                href={`${base}/${diagram.id}`}
                className="hover:bg-sunken flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="font-medium">{diagram.title}</span>
                <span className="text-muted">
                  {DIAGRAM_TYPES.find((type) => type.id === diagram.diagramType)
                    ?.label ?? "Diagram"}{" "}
                  · updated {formatDate(diagram.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No diagrams yet.
        </p>
      )}
    </>
  );
}
