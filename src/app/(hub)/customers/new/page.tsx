import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { CUSTOMER_NAME_MAX_LENGTH } from "@/lib/customers";

import { createCustomerAction } from "../actions";

export const metadata: Metadata = { title: "New customer" };

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader
        title="New customer"
        description="Creating a customer sets up a dedicated database and agent for it. Nothing is shared with other customers."
      />
      <div className={`${cardClass} max-w-lg p-6`}>
        <ActionForm action={createCustomerAction} submitLabel="Create customer">
          <TextField
            name="name"
            label="Customer name"
            required
            maxLength={CUSTOMER_NAME_MAX_LENGTH}
            autoComplete="organization"
          />
        </ActionForm>
      </div>
    </>
  );
}
