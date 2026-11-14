import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";
import { requireCustomer } from "@/lib/hub";

export const metadata: Metadata = { title: "Context sources" };

export default async function CustomerSourcesPage({
  params,
}: PageProps<"/customers/[customerId]/sources">) {
  const { customer } = await requireCustomer((await params).customerId);
  return (
    <>
      <PageHeader
        as="h2"
        title="Context sources"
        description={`Emails, files, pages and issues that belong to ${customer.name}. Only the sources you select are ingested.`}
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>
        No context sources selected yet.
      </p>
    </>
  );
}
