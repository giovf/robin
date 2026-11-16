import type { Metadata } from "next";
import Link from "next/link";

import { cardClass, linkClass } from "@/components/ui";
import { formatDate, orNotFound, requireCustomer } from "@/lib/hub";
import { phaseLabel } from "@/lib/phases";
import { listSolutions } from "@/lib/solutions";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerOverviewPage({
  params,
}: PageProps<"/customers/[customerId]">) {
  const { customerId } = await params;
  const { user, customer } = await requireCustomer(customerId);
  const solutions = await orNotFound(() => listSolutions(user.id, customerId));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <dl className={`${cardClass} flex flex-col gap-3 p-5 text-sm`}>
        <div>
          <dt className="text-muted">Status</dt>
          <dd className="font-medium capitalize">{customer.status}</dd>
        </div>
        <div>
          <dt className="text-muted">Customer since</dt>
          <dd className="font-medium">{formatDate(customer.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-muted">Data</dt>
          <dd className="font-medium">Dedicated database and agent</dd>
        </div>
      </dl>
      <section
        aria-labelledby="overview-solutions"
        className={`${cardClass} flex flex-col gap-3 p-5 md:col-span-2`}
      >
        <h2 id="overview-solutions" className="text-sm font-semibold">
          Solutions ({solutions.length})
        </h2>
        {solutions.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {solutions.map((solution) => (
              <li key={solution.id} className="flex justify-between gap-4">
                <Link
                  href={`/customers/${customer.id}/solutions/${solution.id}`}
                  className={linkClass}
                >
                  {solution.name}
                </Link>
                <span className="text-muted">
                  {phaseLabel(solution.currentPhase)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">
            No solutions yet.{" "}
            <Link
              href={`/customers/${customer.id}/solutions/new`}
              className={linkClass}
            >
              Create one
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
