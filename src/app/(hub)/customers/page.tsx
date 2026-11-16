import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { cardClass, primaryButtonClass } from "@/components/ui";
import { listCustomers } from "@/lib/customers";
import { formatDate } from "@/lib/hub";
import { requireUser } from "@/lib/session";

import { restoreCustomerAction } from "./actions";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const user = await requireUser();
  const customers = await listCustomers(user.organizationId);
  const active = customers.filter((customer) => customer.status === "active");
  const archived = customers.filter(
    (customer) => customer.status === "archived",
  );

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every customer is fully isolated: its own database and its own agent."
        actions={
          <Link href="/customers/new" className={primaryButtonClass}>
            New customer
          </Link>
        }
      />
      {active.length ? (
        <ul className={`${cardClass} divide-line divide-y overflow-hidden`}>
          {active.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/customers/${customer.id}`}
                className="hover:bg-sunken flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="font-medium">{customer.name}</span>
                <span className="text-muted">
                  Added {formatDate(customer.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No customers yet. Create your first one to get started.
        </p>
      )}
      {archived.length ? (
        <details className="text-sm">
          <summary className="text-muted cursor-pointer">
            Archived ({archived.length})
          </summary>
          <p className="text-muted mt-2">
            Archived customers keep their data but cannot be opened. Restore one
            to use, export or permanently delete it.
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {archived.map((customer) => (
              <li
                key={customer.id}
                className="flex flex-wrap items-center justify-between gap-3"
              >
                <span className="text-muted">
                  {customer.name} — archived {formatDate(customer.updatedAt)}
                </span>
                <ActionForm
                  action={restoreCustomerAction.bind(null, customer.id)}
                  submitLabel={`Restore ${customer.name}`}
                  variant="secondary"
                  className="flex flex-col items-end gap-2"
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
