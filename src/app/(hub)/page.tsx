import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { cardClass, primaryButtonClass } from "@/components/ui";
import { listCustomers } from "@/lib/customers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const customers = await listCustomers(user.organizationId);
  const active = customers.filter((customer) => customer.status === "active");

  return (
    <>
      <PageHeader
        title={user.name ? `Welcome, ${user.name}` : "Welcome"}
        description="Pick a customer to see its solutions, calls and documents."
      />
      <section
        aria-labelledby="active-customers"
        className="flex flex-col gap-3"
      >
        <h2 id="active-customers" className="text-sm font-semibold">
          Active customers ({active.length})
        </h2>
        {active.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className={`${cardClass} hover:border-accent block p-4 text-sm font-medium transition-colors`}
                >
                  {customer.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className={`${cardClass} flex flex-col items-start gap-3 p-6`}>
            <p className="text-muted text-sm">
              No customers yet. Each customer gets its own isolated database and
              agent.
            </p>
            <Link href="/customers" className={primaryButtonClass}>
              Go to customers
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
