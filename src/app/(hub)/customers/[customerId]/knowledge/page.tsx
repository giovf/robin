import type { Metadata } from "next";
import Link from "next/link";

import type { SourceItemProvider } from "@/db/customer/schema";
import { PageHeader } from "@/components/page-header";
import {
  cardClass,
  inputClass,
  linkClass,
  secondaryButtonClass,
} from "@/components/ui";
import { formatDate, orNotFound, requireCustomer } from "@/lib/hub";
import {
  getKnowledgeTotals,
  listSourceItems,
  SOURCE_ITEMS_PAGE_SIZE,
} from "@/lib/knowledge";
import { retrieveContext } from "@/lib/retrieval";

export const metadata: Metadata = { title: "Knowledge" };

const PROVIDER_LABELS: Record<SourceItemProvider, string> = {
  upload: "Upload",
  gmail: "Gmail",
  google_drive: "Drive",
  confluence: "Confluence",
  jira: "Jira",
};

export default async function CustomerKnowledgePage({
  params,
  searchParams,
}: PageProps<"/customers/[customerId]/knowledge">) {
  const { customerId } = await params;
  const { user, customer } = await requireCustomer(customerId);
  const query = await searchParams;
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 300) : "";
  const page = Math.max(Number(query.page) || 1, 1);
  const base = `/customers/${customer.id}/knowledge`;

  const [totals, items, hits] = await orNotFound(() =>
    Promise.all([
      getKnowledgeTotals(user.id, customerId),
      listSourceItems(user.id, customerId, { page }),
      q ? retrieveContext(user.id, customerId, q, { limit: 8 }) : null,
    ]),
  );

  return (
    <>
      <PageHeader
        as="h2"
        title="Knowledge"
        description={`What Robin knows about ${customer.name}: ${totals.itemCount} ${totals.itemCount === 1 ? "item" : "items"} in ${totals.chunkCount} ${totals.chunkCount === 1 ? "chunk" : "chunks"}.`}
      />

      <section
        aria-labelledby="search-heading"
        className={`${cardClass} flex flex-col gap-4 p-6`}
      >
        <h3 id="search-heading" className="text-base font-semibold">
          Search this customer&apos;s context
        </h3>
        <form action={base} role="search" className="flex flex-wrap gap-3">
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            maxLength={300}
            placeholder="e.g. message bus decision"
            className={`${inputClass} max-w-md flex-1`}
          />
          <button type="submit" className={secondaryButtonClass}>
            Search
          </button>
        </form>
        {hits ? (
          hits.length ? (
            <ol className="flex flex-col gap-3">
              {hits.map((hit) => (
                <li
                  key={hit.chunkId}
                  className="border-line rounded-control border p-3 text-sm"
                >
                  <p className="text-muted mb-1 text-xs">
                    {hit.source.type === "source_item" ? (
                      <Link
                        href={`${base}/${hit.source.id}`}
                        className={linkClass}
                      >
                        {hit.source.title}
                      </Link>
                    ) : (
                      (hit.source.title ?? "Call transcript")
                    )}{" "}
                    · match {Math.round(hit.similarity * 100)}%
                  </p>
                  <p className="line-clamp-4 whitespace-pre-line">{hit.text}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-muted text-sm">Nothing matches “{q}”.</p>
          )
        ) : null}
      </section>

      <section aria-labelledby="items-heading" className="flex flex-col gap-3">
        <h3 id="items-heading" className="text-base font-semibold">
          Ingested items
        </h3>
        {items.length ? (
          <div className={`${cardClass} overflow-x-auto`}>
            <table className="w-full text-left text-sm">
              <thead className="text-muted border-line border-b text-xs">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Title
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Source
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Chunks
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Synced
                  </th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {items.map((item) => (
                  <tr key={item.id}>
                    <th scope="row" className="px-4 py-2 font-normal">
                      <Link href={`${base}/${item.id}`} className={linkClass}>
                        {item.title}
                      </Link>
                    </th>
                    <td className="text-muted px-4 py-2">
                      {PROVIDER_LABELS[item.provider]}
                    </td>
                    <td className="text-muted px-4 py-2">{item.chunkCount}</td>
                    <td className="text-muted px-4 py-2 whitespace-nowrap">
                      {item.syncedAt ? formatDate(item.syncedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={`${cardClass} text-muted p-6 text-sm`}>
            {page > 1 ? "No more items." : "Nothing ingested yet."}{" "}
            <Link
              href={`/customers/${customer.id}/sources`}
              className={linkClass}
            >
              Add context sources or upload files
            </Link>
          </p>
        )}
        <nav aria-label="Pages" className="flex gap-4 text-sm">
          {page > 1 ? (
            <Link href={`${base}?page=${page - 1}`} className={linkClass}>
              Previous
            </Link>
          ) : null}
          {items.length === SOURCE_ITEMS_PAGE_SIZE ? (
            <Link href={`${base}?page=${page + 1}`} className={linkClass}>
              Next
            </Link>
          ) : null}
        </nav>
      </section>
    </>
  );
}
