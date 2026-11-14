import type { FormState } from "@/lib/form-action";
import { formatDate } from "@/lib/hub";
import type {
  IntegrationConnectionSummary,
  ProviderInfo,
} from "@/lib/integrations";

import { ActionForm } from "./action-form";
import { cardClass, primaryButtonClass, secondaryButtonClass } from "./ui";

interface IntegrationCardProps {
  info: ProviderInfo;
  /** Whether the provider's credentials are configured on this server. */
  available: boolean;
  connections: IntegrationConnectionSummary[];
  /** Builds the disconnect action for a connection. */
  disconnect: (
    connectionId: string,
  ) => (state: FormState, formData: FormData) => Promise<FormState>;
}

export function IntegrationCard({
  info,
  available,
  connections,
  disconnect,
}: IntegrationCardProps) {
  const headingId = `integration-${info.provider}`;
  return (
    <section
      aria-labelledby={headingId}
      className={`${cardClass} flex flex-col gap-4 p-6`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id={headingId} className="text-base font-semibold">
            {info.name}
          </h2>
          <p className="text-muted mt-1 text-sm">{info.description}</p>
        </div>
        {available ? (
          // A plain link: this leaves the app for the provider's consent page.
          <a
            href={`/api/integrations/${info.provider}/authorize`}
            className={
              connections.length ? secondaryButtonClass : primaryButtonClass
            }
          >
            {connections.length ? "Connect another account" : "Connect"}
          </a>
        ) : null}
      </div>

      {available ? null : (
        <p className="bg-sunken rounded-control px-3 py-2 text-sm">
          Not available yet. To enable it, set{" "}
          {info.requiredEnv.map((name, index) => (
            <span key={name}>
              {index ? " and " : ""}
              <code className="font-mono text-xs">{name}</code>
            </span>
          ))}{" "}
          on the server.
        </p>
      )}

      {connections.length ? (
        <ul className="divide-line border-line divide-y border-t">
          {connections.map((connection) => (
            <li
              key={connection.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {connection.accountLabel ?? "Connected account"}
                </p>
                <p className="text-muted">
                  {connection.status === "active"
                    ? `Connected ${formatDate(connection.createdAt)}`
                    : "Needs reconnecting — access expired or was revoked"}
                </p>
              </div>
              <ActionForm
                action={disconnect(connection.id)}
                submitLabel="Disconnect"
                variant="danger"
                className="flex flex-col items-end gap-2"
              >
                <span className="sr-only">
                  Disconnect {connection.accountLabel}
                </span>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
