import type { Metadata } from "next";

import { IntegrationCard } from "@/components/integration-card";
import { PageHeader } from "@/components/page-header";
import {
  listIntegrationConnections,
  PROVIDERS,
  resolveAdapter,
} from "@/lib/integrations";
import {
  OAUTH_FAILURE_MESSAGES,
  type OAuthFailure,
} from "@/lib/integrations/oauth-flow";
import { requireUser } from "@/lib/session";

import { disconnectIntegrationAction } from "./actions";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage({
  searchParams,
}: PageProps<"/integrations">) {
  const user = await requireUser();
  const { connected, error } = await searchParams;
  const connections = await listIntegrationConnections(user.organizationId);

  const connectedInfo = PROVIDERS.find((info) => info.provider === connected);
  const failure =
    typeof error === "string" && error in OAUTH_FAILURE_MESSAGES
      ? OAUTH_FAILURE_MESSAGES[error as OAuthFailure]
      : null;

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect the accounts Robin may read from. Connecting does not ingest anything: you choose per customer which labels, folders, spaces and projects belong to it."
      />
      {connectedInfo ? (
        <p
          role="status"
          className="bg-success-soft text-success rounded-control px-3 py-2 text-sm"
        >
          {connectedInfo.name} is connected.
        </p>
      ) : null}
      {failure ? (
        <p
          role="alert"
          className="bg-danger-soft text-danger rounded-control px-3 py-2 text-sm"
        >
          {failure}
        </p>
      ) : null}
      <div className="grid gap-4">
        {PROVIDERS.map((info) => (
          <IntegrationCard
            key={info.provider}
            info={info}
            available={resolveAdapter(info.provider) !== null}
            connections={connections.filter(
              (connection) => connection.provider === info.provider,
            )}
            disconnect={(connectionId) =>
              disconnectIntegrationAction.bind(null, connectionId)
            }
          />
        ))}
      </div>
    </>
  );
}
