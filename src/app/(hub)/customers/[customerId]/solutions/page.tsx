import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { getCustomer } from "@/lib/customers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Solutions" };

export default async function SolutionsPage({
  params,
}: PageProps<"/customers/[customerId]/solutions">) {
  const user = await requireUser();
  const { customerId } = await params;
  const customer = await getCustomer(user.organizationId, customerId);
  if (!customer) notFound();

  return (
    <>
      <PageHeader
        title="Solutions"
        description={`Solutions for ${customer.name}.`}
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>
        No solutions yet.{" "}
        <Link href={`/customers/${customer.id}`} className="underline">
          Back to {customer.name}
        </Link>
      </p>
    </>
  );
}
