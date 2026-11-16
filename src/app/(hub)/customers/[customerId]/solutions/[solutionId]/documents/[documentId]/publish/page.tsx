import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Field, TextField } from "@/components/field";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { cardClass, inputClass, linkClass } from "@/components/ui";
import { requireDocument } from "@/lib/documents/page-context";
import {
  getFreshIntegrationTokens,
  IntegrationError,
  listIntegrationConnections,
  resolveAdapter,
} from "@/lib/integrations";

import { publishDocumentAction } from "../../actions";

export const metadata: Metadata = { title: "Publish to Confluence" };

interface SpaceOption {
  value: string;
  label: string;
}

async function confluenceSpaces(organizationId: string): Promise<{
  spaces: SpaceOption[];
  connected: boolean;
  failed: boolean;
}> {
  const adapter = resolveAdapter("atlassian");
  const connections = (await listIntegrationConnections(organizationId)).filter(
    (connection) =>
      connection.provider === "atlassian" && connection.status === "active",
  );
  if (!adapter || !connections.length) {
    return { spaces: [], connected: false, failed: false };
  }
  const spaces: SpaceOption[] = [];
  let failed = false;
  for (const connection of connections) {
    try {
      const fresh = await getFreshIntegrationTokens(
        organizationId,
        connection.id,
      );
      if (!fresh) continue;
      for (const space of await adapter.listSources(
        fresh.tokens,
        "confluence",
      )) {
        spaces.push({
          value: `${connection.id}|${space.id}`,
          label: space.name,
        });
      }
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      failed = true;
    }
  }
  return { spaces, connected: true, failed };
}

export default async function PublishDocumentPage({
  params,
}: PageProps<"/customers/[customerId]/solutions/[solutionId]/documents/[documentId]/publish">) {
  const { customerId, solutionId, documentId } = await params;
  const { user, detail } = await requireDocument(
    customerId,
    solutionId,
    documentId,
  );
  const { document, version } = detail;
  const base = `/customers/${customerId}/solutions/${solutionId}/documents/${document.id}`;
  const { spaces, connected, failed } = await confluenceSpaces(
    user.organizationId,
  );

  return (
    <>
      <div>
        <Link href={base} className="text-muted text-sm underline">
          {document.title}
        </Link>
      </div>
      <PageHeader
        as="h3"
        title="Publish to Confluence"
        description="This creates a new page in your customer's Confluence. Nothing is sent until you confirm below."
      />

      {spaces.length ? (
        <section
          aria-labelledby="publish-form-heading"
          className={`${cardClass} flex max-w-2xl flex-col gap-4 p-6`}
        >
          <h4 id="publish-form-heading" className="text-base font-semibold">
            Where to publish
          </h4>
          <ActionForm
            action={publishDocumentAction.bind(
              null,
              customerId,
              solutionId,
              document.id,
              version.version,
            )}
            submitLabel="Confirm and publish"
          >
            <Field id="space" label="Confluence space">
              <select id="space" name="space" required className={inputClass}>
                {spaces.map((space) => (
                  <option key={space.value} value={space.value}>
                    {space.label}
                  </option>
                ))}
              </select>
            </Field>
            <TextField
              name="pageTitle"
              label="Page title"
              defaultValue={document.title}
              required
              maxLength={255}
            />
            <label className="border-line bg-sunken rounded-control flex items-start gap-2 border p-4 text-sm">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                required
                className="mt-0.5 size-4"
              />
              <span>
                I have reviewed version {version.version} below and want it
                published as a new page that people at the customer can see.
              </span>
            </label>
          </ActionForm>
        </section>
      ) : (
        <p className={`${cardClass} max-w-2xl p-6 text-sm`}>
          {connected
            ? failed
              ? "The Confluence spaces could not be loaded. "
              : "No Confluence spaces are available through the connected account. "
            : "Publishing needs an Atlassian account connected with publishing access. "}
          <Link href="/integrations" className={linkClass}>
            Open Integrations
          </Link>
        </p>
      )}

      <section
        aria-labelledby="preview-heading"
        className="flex flex-col gap-3"
      >
        <h4 id="preview-heading" className="text-base font-semibold">
          What will be published — version {version.version}
        </h4>
        <div className={`${cardClass} p-6`}>
          <Markdown>{version.content}</Markdown>
        </div>
      </section>
    </>
  );
}
