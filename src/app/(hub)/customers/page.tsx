import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { listCustomers } from "@/lib/customers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const user = await requireUser();
  const customers = await listCustomers(user.organizationId);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Every customer is fully isolated: its own database and its own agent."
      />
      {customers.length ? (
        <ul className={`${cardClass} divide-line divide-y`}>
          {customers.map((customer) => (
            <li key={customer.id}>
              <Link
                href={`/customers/${customer.id}`}
                className="hover:bg-sunken flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <span className="font-medium">{customer.name}</span>
                <span className="text-muted capitalize">{customer.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No customers yet.
        </p>
      )}
    </>
  );
}
