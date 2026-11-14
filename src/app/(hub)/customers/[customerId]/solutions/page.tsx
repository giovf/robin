import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SolutionCard } from "@/components/solution-card";
import { cardClass, primaryButtonClass } from "@/components/ui";
import { orNotFound, requireCustomer } from "@/lib/hub";
import { listSolutions } from "@/lib/solutions";

export const metadata: Metadata = { title: "Solutions" };

export default async function SolutionsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions">) {
  const { customerId } = await params;
  const { user, customer } = await requireCustomer(customerId);
  const all = await orNotFound(() =>
    listSolutions(user.id, customerId, { includeArchived: true }),
  );
  const current = all.filter((solution) => solution.status !== "archived");
  const archived = all.filter((solution) => solution.status === "archived");

  return (
    <>
      <PageHeader
        as="h2"
        title="Solutions"
        description={`What you are designing and delivering for ${customer.name}.`}
        actions={
          <Link
            href={`/customers/${customer.id}/solutions/new`}
            className={primaryButtonClass}
          >
            New solution
          </Link>
        }
      />
      {current.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {current.map((solution) => (
            <li key={solution.id}>
              <SolutionCard customerId={customer.id} solution={solution} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No solutions yet.
        </p>
      )}
      {archived.length ? (
        <details className="text-sm">
          <summary className="text-muted cursor-pointer">
            Archived ({archived.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-1 pl-4">
            {archived.map((solution) => (
              <li key={solution.id}>
                <Link
                  href={`/customers/${customer.id}/solutions/${solution.id}`}
                  className="text-muted underline"
                >
                  {solution.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
