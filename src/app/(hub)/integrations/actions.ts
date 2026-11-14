"use server";

import { refresh } from "next/cache";

import { runFormAction, type FormState } from "@/lib/form-action";
import { deleteIntegrationConnection } from "@/lib/integrations";
import { requireUser } from "@/lib/session";

export async function disconnectIntegrationAction(
  connectionId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const deleted = await deleteIntegrationConnection(
      user.organizationId,
      connectionId,
    );
    if (!deleted) return { error: "This connection no longer exists." };
    refresh();
  });
}
