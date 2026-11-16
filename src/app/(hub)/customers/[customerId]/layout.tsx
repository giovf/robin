import Link from "next/link";

import { Tabs } from "@/components/tabs";
import { requireCustomer } from "@/lib/hub";

export default async function CustomerLayout({
  children,
  params,
}: LayoutProps<"/customers/[customerId]">) {
  const { customerId } = await params;
  const { customer } = await requireCustomer(customerId);
  const base = `/customers/${customer.id}`;

  return (
    <>
      <div className="flex flex-col gap-4">
        <div>
          <Link href="/customers" className="text-muted text-sm underline">
            Customers
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {customer.name}
          </h1>
        </div>
        <Tabs
          label="Customer sections"
          items={[
            { href: base, label: "Overview" },
            { href: `${base}/solutions`, label: "Solutions" },
            { href: `${base}/documents`, label: "Documents" },
            { href: `${base}/sources`, label: "Context sources" },
            { href: `${base}/knowledge`, label: "Knowledge" },
            { href: `${base}/settings`, label: "Settings" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
