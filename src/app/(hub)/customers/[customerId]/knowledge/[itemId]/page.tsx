import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/page-header";
import { cardClass, linkClass } from "@/components/ui";
import { formatDate, orNotFound, requireCustomer } from "@/lib/hub";
import { getSourceItem } from "@/lib/knowledge";

import { deleteSourceItemAction } from "../actions";

export const metadata: Metadata = { title: "Ingested item" };

/** Only http(s) links are rendered: the URL comes from an external system. */
function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

export default async function SourceItemPage({
  params,
}: PageProps<"/customers/[customerId]/knowledge/[itemId]">) {
  const { customerId, itemId } = await params;
  const { user } = await requireCustomer(customerId);
  const item = await orNotFound(() =>
    getSourceItem(user.id, customerId, itemId),
  );
  if (!item) notFound();
  const url = safeUrl(item.url);

  return (
    <>
      <div>
        <Link
          href={`/customers/${customerId}/knowledge`}
          className="text-muted text-sm underline"
        >
          Knowledge
        </Link>
      </div>
      <PageHeader
        as="h2"
        title={item.title}
        description={`${item.chunks.length} ${item.chunks.length === 1 ? "chunk" : "chunks"}${item.syncedAt ? ` · synced ${formatDate(item.syncedAt)}` : ""}`}
        actions={
          <ActionForm
            action={deleteSourceItemAction.bind(null, customerId, item.id)}
            submitLabel="Remove from context"
            variant="danger"
            className="flex flex-col items-end gap-2"
          />
        }
      />
      {url ? (
        <p className="text-sm">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Open the original
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : null}
      <ol className="flex flex-col gap-3">
        {item.chunks.map((chunk) => (
          <li key={chunk.id} className={`${cardClass} p-4 text-sm`}>
            <p className="text-muted mb-2 text-xs">
              Chunk {chunk.chunkIndex + 1}
            </p>
            <p className="whitespace-pre-line">{chunk.text}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
