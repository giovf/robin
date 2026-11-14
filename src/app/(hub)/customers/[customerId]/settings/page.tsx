import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { TextField } from "@/components/field";
import { cardClass, secondaryButtonClass } from "@/components/ui";
import { CUSTOMER_NAME_MAX_LENGTH } from "@/lib/customers";
import { requireCustomer } from "@/lib/hub";

import {
  archiveCustomerAction,
  deleteCustomerAction,
  renameCustomerAction,
} from "../../actions";

export const metadata: Metadata = { title: "Customer settings" };

export default async function CustomerSettingsPage({
  params,
}: PageProps<"/customers/[customerId]/settings">) {
  const { customer } = await requireCustomer((await params).customerId);

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <section
        aria-labelledby="rename-heading"
        className={`${cardClass} flex flex-col gap-4 p-6`}
      >
        <h2 id="rename-heading" className="text-base font-semibold">
          Details
        </h2>
        <ActionForm
          key={customer.name}
          action={renameCustomerAction.bind(null, customer.id)}
          submitLabel="Save"
        >
          <TextField
            name="name"
            label="Customer name"
            defaultValue={customer.name}
            required
            maxLength={CUSTOMER_NAME_MAX_LENGTH}
          />
        </ActionForm>
      </section>

      <section
        aria-labelledby="export-heading"
        className={`${cardClass} flex flex-col items-start gap-4 p-6`}
      >
        <div>
          <h2 id="export-heading" className="text-base font-semibold">
            Export data
          </h2>
          <p className="text-muted mt-1 text-sm">
            Download everything Robin holds about {customer.name} as a JSON
            file: solutions, calls, transcripts, documents, diagrams and
            ingested context.
          </p>
        </div>
        <a
          href={`/api/customers/${customer.id}/export`}
          download
          className={secondaryButtonClass}
        >
          Download export
        </a>
      </section>

      <section
        aria-labelledby="archive-heading"
        className="border-danger/40 rounded-card flex flex-col gap-4 border p-6"
      >
        <div>
          <h2 id="archive-heading" className="text-base font-semibold">
            Archive customer
          </h2>
          <p className="text-muted mt-1 text-sm">
            Archiving hides {customer.name} from the hub and blocks all access
            to its data. The data itself is kept, not deleted.
          </p>
        </div>
        <ActionForm
          action={archiveCustomerAction.bind(null, customer.id)}
          submitLabel="Archive customer"
          variant="danger"
        >
          <TextField
            name="confirm"
            label={`Type “${customer.name}” to confirm`}
            required
          />
        </ActionForm>
      </section>

      <section
        aria-labelledby="delete-heading"
        className="border-danger/40 rounded-card flex flex-col gap-4 border p-6"
      >
        <div>
          <h2 id="delete-heading" className="text-base font-semibold">
            Delete customer permanently
          </h2>
          <p className="text-muted mt-1 text-sm">
            This permanently deletes all data for {customer.name}:
          </p>
          <ul className="text-muted mt-2 list-disc pl-5 text-sm">
            <li>all solutions, documents and diagrams</li>
            <li>all calls and transcripts</li>
            <li>all ingested context and the customer&apos;s agent memory</li>
          </ul>
          <p className="mt-2 text-sm font-semibold">
            This cannot be undone. Export the data first if you may need it.
          </p>
        </div>
        <ActionForm
          action={deleteCustomerAction.bind(null, customer.id)}
          submitLabel="Delete forever"
          variant="danger"
        >
          <TextField
            name="confirm-delete"
            label={`Type “${customer.name}” to confirm`}
            required
          />
        </ActionForm>
      </section>
    </div>
  );
}
