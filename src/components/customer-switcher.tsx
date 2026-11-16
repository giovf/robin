"use client";

import { useParams, useRouter } from "next/navigation";

interface CustomerOption {
  id: string;
  name: string;
}

/** Shows the customer currently in context and lets the user switch. */
export function CustomerSwitcher({
  customers,
}: {
  customers: CustomerOption[];
}) {
  const router = useRouter();
  const params = useParams<{ customerId?: string }>();
  const currentId = params.customerId ?? "";

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor="customer-switcher"
        className="text-muted text-xs font-semibold tracking-wide uppercase"
      >
        Customer
      </label>
      <select
        id="customer-switcher"
        value={currentId}
        onChange={(event) => {
          const id = event.target.value;
          router.push(id ? `/customers/${id}` : "/customers");
        }}
        className="border-line bg-surface text-ink rounded-control w-full border px-2 py-2 text-sm"
      >
        <option value="">
          {customers.length ? "All customers" : "No customers yet"}
        </option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </select>
    </div>
  );
}
