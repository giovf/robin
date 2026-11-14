import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { requireCustomer } from "@/lib/hub";
import {
  SOLUTION_DESCRIPTION_MAX_LENGTH,
  SOLUTION_NAME_MAX_LENGTH,
} from "@/lib/solutions";

import { createSolutionAction } from "../actions";

export const metadata: Metadata = { title: "New solution" };

export default async function NewSolutionPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/new">) {
  const { customer } = await requireCustomer((await params).customerId);
  return (
    <>
      <PageHeader
        as="h2"
        title="New solution"
        description={`A solution for ${customer.name}. It starts in the Discovery phase.`}
      />
      <div className={`${cardClass} max-w-lg p-6`}>
        <ActionForm
          action={createSolutionAction.bind(null, customer.id)}
          submitLabel="Create solution"
        >
          <TextField
            name="name"
            label="Name"
            required
            maxLength={SOLUTION_NAME_MAX_LENGTH}
          />
          <TextField
            name="description"
            label="Description"
            hint="Optional. What is this solution about?"
            multiline
            maxLength={SOLUTION_DESCRIPTION_MAX_LENGTH}
          />
        </ActionForm>
      </div>
    </>
  );
}
