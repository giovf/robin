import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { secondaryButtonClass } from "@/components/ui";
import { getCustomer } from "@/lib/customers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({
  params,
}: PageProps<"/customers/[customerId]">) {
  const user = await requireUser();
  const { customerId } = await params;
  const customer = await getCustomer(user.organizationId, customerId);
  if (!customer) notFound();

  return (
    <PageHeader
      title={customer.name}
      description={
        customer.status === "archived"
          ? "This customer is archived."
          : "Solutions, calls, documents and context sources for this customer."
      }
      actions={
        <Link
          href={`/customers/${customer.id}/solutions`}
          className={secondaryButtonClass}
        >
          Solutions
        </Link>
      }
    />
  );
}
