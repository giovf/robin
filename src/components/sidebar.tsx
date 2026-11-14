import Link from "next/link";
import { Suspense } from "react";

import { listCustomers } from "@/lib/customers";
import { requireUser } from "@/lib/session";

import { CustomerSwitcher } from "./customer-switcher";
import { NavLinks } from "./nav-links";
import { RobinMark } from "./robin-mark";
import { UserMenu } from "./user-menu";

async function SidebarCustomers() {
  const user = await requireUser();
  const customers = (await listCustomers(user.organizationId))
    .filter((customer) => customer.status === "active")
    .map(({ id, name }) => ({ id, name }));
  return <CustomerSwitcher customers={customers} />;
}

function Placeholder({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`bg-sunken rounded-control ${className}`}
    />
  );
}

export function Sidebar() {
  return (
    <header className="border-line bg-surface flex shrink-0 flex-col gap-4 border-b p-4 md:sticky md:top-0 md:h-dvh md:w-60 md:gap-6 md:border-r md:border-b-0">
      <Link href="/" className="rounded-control self-start text-lg">
        <RobinMark />
      </Link>
      <Suspense fallback={<Placeholder className="h-14" />}>
        <SidebarCustomers />
      </Suspense>
      <nav aria-label="Main">
        <Suspense fallback={<Placeholder className="h-9 md:h-28" />}>
          <NavLinks />
        </Suspense>
      </nav>
      <div className="md:mt-auto">
        <Suspense fallback={<Placeholder className="h-9" />}>
          <UserMenu />
        </Suspense>
      </div>
    </header>
  );
}
