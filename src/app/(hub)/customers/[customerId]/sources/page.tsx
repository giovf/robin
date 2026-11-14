import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import type { CustomerSourceKind } from "@/db/control-plane/schema";
import { ActionForm } from "@/components/action-form";
import { Field, TextField } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { UploadForm } from "@/components/upload-form";
import { cardClass, inputClass, linkClass } from "@/components/ui";
import {
  GMAIL_QUERY_MAX_LENGTH,
  listAvailableSources,
  listCustomerSources,
  type CustomerSourceSummary,
} from "@/lib/customer-sources";
import { formatDate, requireCustomer } from "@/lib/hub";
import {
  IntegrationError,
  listIntegrationConnections,
  resolveAdapter,
  type IntegrationConnectionSummary,
} from "@/lib/integrations";

import { MAX_UPLOAD_BYTES, UPLOAD_EXTENSIONS } from "@/lib/text-extraction";

import {
  addCustomerSourceAction,
  addGmailQuerySourceAction,
  removeCustomerSourceAction,
  syncCustomerSourceAction,
} from "./actions";

export const metadata: Metadata = { title: "Context sources" };

const KIND_LABELS: Record<CustomerSourceKind, string> = {
  gmail: "Gmail label",
  google_drive: "Drive folder",
  confluence: "Confluence space",
  jira: "Jira project",
};

function syncSummary(source: CustomerSourceSummary): string {
  if (source.lastSyncStatus === "running") return "Syncing…";
  if (source.lastSyncStatus === "error") {
    return `Last sync failed: ${source.lastSyncError ?? "unknown error"}`;
  }
  if (source.lastSyncStatus === "ok" && source.lastSyncedAt) {
    return `Synced ${formatDate(source.lastSyncedAt)} · ${source.lastSyncItemCount ?? 0} items`;
  }
  return "Not synced yet";
}

interface PickerProps {
  organizationId: string;
  customerId: string;
  connection: IntegrationConnectionSummary;
  kind: CustomerSourceKind;
}

/** Lists what the provider offers; streams in, since it calls the provider. */
async function SourcePicker({
  organizationId,
  customerId,
  connection,
  kind,
}: PickerProps) {
  let sources;
  try {
    sources = await listAvailableSources(organizationId, connection.id, kind);
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return (
      <p className="text-danger text-sm">
        Could not load {KIND_LABELS[kind].toLowerCase()}s from this account.{" "}
        {error.needsReauth ? "Reconnect it on the Integrations page." : ""}
      </p>
    );
  }
  if (!sources.length) {
    return (
      <p className="text-muted text-sm">
        No {KIND_LABELS[kind].toLowerCase()}s found in this account.
      </p>
    );
  }
  const fieldId = `source-${connection.id}-${kind}`;
  return (
    <ActionForm
      action={addCustomerSourceAction.bind(
        null,
        customerId,
        connection.id,
        kind,
      )}
      submitLabel="Add"
      variant="secondary"
      className="flex flex-wrap items-end gap-3"
    >
      <Field id={fieldId} label={KIND_LABELS[kind]}>
        <select id={fieldId} name="sourceId" required className={inputClass}>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </Field>
    </ActionForm>
  );
}

export default async function CustomerSourcesPage({
  params,
}: PageProps<"/customers/[customerId]/sources">) {
  const { customerId } = await params;
  const { user, customer } = await requireCustomer(customerId);
  const selected =
    (await listCustomerSources(user.organizationId, customerId)) ?? [];
  const connections = (
    await listIntegrationConnections(user.organizationId)
  ).filter((connection) => connection.status === "active");

  return (
    <>
      <PageHeader
        as="h2"
        title="Context sources"
        description={`Emails, files, pages and issues that belong to ${customer.name}. Only what you select here is ever ingested.`}
      />

      <section
        aria-labelledby="selected-heading"
        className={`${cardClass} flex flex-col gap-3 p-6`}
      >
        <h3 id="selected-heading" className="text-base font-semibold">
          Selected ({selected.length})
        </h3>
        {selected.length ? (
          <ul className="divide-line divide-y">
            {selected.map((source) => (
              <li
                key={source.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{source.name}</span>{" "}
                  <span className="text-muted">
                    · {KIND_LABELS[source.kind]}
                  </span>
                  <span
                    className={`block text-xs ${
                      source.lastSyncStatus === "error"
                        ? "text-danger"
                        : "text-muted"
                    }`}
                  >
                    {syncSummary(source)}
                  </span>
                </span>
                <ActionForm
                  action={syncCustomerSourceAction.bind(
                    null,
                    customerId,
                    source.id,
                  )}
                  submitLabel={`Sync ${source.name}`}
                  className="flex flex-col items-end gap-2"
                />
                <ActionForm
                  action={removeCustomerSourceAction.bind(
                    null,
                    customerId,
                    source.id,
                  )}
                  submitLabel={`Remove ${source.name}`}
                  variant="secondary"
                  className="flex flex-col items-end gap-2"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted text-sm">Nothing selected yet.</p>
        )}
      </section>

      <section
        aria-labelledby="upload-heading"
        className={`${cardClass} flex flex-col gap-4 p-6`}
      >
        <div>
          <h3 id="upload-heading" className="text-base font-semibold">
            Upload files
          </h3>
          <p className="text-muted mt-1 text-sm">
            Add documents directly to {customer.name}&apos;s context.
          </p>
        </div>
        <UploadForm
          customerId={customerId}
          accept={UPLOAD_EXTENSIONS.join(",")}
          maxMegabytes={MAX_UPLOAD_BYTES / 1024 / 1024}
        />
      </section>

      {connections.length ? (
        connections.map((connection) => {
          const adapter = resolveAdapter(connection.provider);
          if (!adapter) return null;
          return (
            <section
              key={connection.id}
              aria-label={`Add from ${connection.accountLabel}`}
              className={`${cardClass} flex flex-col gap-5 p-6`}
            >
              <h3 className="text-base font-semibold">
                Add from {connection.accountLabel ?? connection.provider}
              </h3>
              {adapter.sourceKinds.map((kind) => (
                <Suspense
                  key={kind}
                  fallback={
                    <p className="text-muted text-sm">
                      Loading {KIND_LABELS[kind].toLowerCase()}s…
                    </p>
                  }
                >
                  <SourcePicker
                    organizationId={user.organizationId}
                    customerId={customerId}
                    connection={connection}
                    kind={kind}
                  />
                </Suspense>
              ))}
              {adapter.sourceKinds.includes("gmail") ? (
                <ActionForm
                  action={addGmailQuerySourceAction.bind(
                    null,
                    customerId,
                    connection.id,
                  )}
                  submitLabel="Add search"
                  variant="secondary"
                >
                  <TextField
                    name="query"
                    id={`query-${connection.id}`}
                    label="Gmail search"
                    hint="Emails matching a Gmail search, e.g. from:acme.com OR to:acme.com"
                    maxLength={GMAIL_QUERY_MAX_LENGTH}
                    required
                  />
                </ActionForm>
              ) : null}
            </section>
          );
        })
      ) : (
        <p className={`${cardClass} text-muted p-6 text-sm`}>
          No accounts connected yet.{" "}
          <Link href="/integrations" className={linkClass}>
            Connect one on the Integrations page
          </Link>
          , then choose what belongs to {customer.name}.
        </p>
      )}
    </>
  );
}
