import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { cardClass } from "@/components/ui";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsPage() {
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connections to Google (Gmail, Drive, Calendar) and Atlassian (Confluence, Jira)."
      />
      <p className={`${cardClass} text-muted p-6 text-sm`}>
        No integrations connected yet.
      </p>
    </>
  );
}
