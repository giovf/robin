"use server";

import { refresh } from "next/cache";
import { after } from "next/server";

import {
  addCustomerSource,
  addGmailQuerySource,
  listCustomerSources,
  removeCustomerSource,
} from "@/lib/customer-sources";
import { runFormAction, type FormState } from "@/lib/form-action";
import { syncCustomerSource } from "@/lib/ingestion/sync";
import { IntegrationError } from "@/lib/integrations";
import { requireUser } from "@/lib/session";

const GONE: FormState = {
  error: "This customer or connection is not available.",
};

export async function addCustomerSourceAction(
  customerId: string,
  connectionId: string,
  kind: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    try {
      const added = await addCustomerSource(user.organizationId, customerId, {
        connectionId,
        kind,
        sourceId: formData.get("sourceId"),
      });
      if (!added) return GONE;
    } catch (error) {
      if (error instanceof IntegrationError) {
        return { error: "The provider could not be reached. Try again." };
      }
      throw error;
    }
    refresh();
    return { message: "Added." };
  });
}

export async function addGmailQuerySourceAction(
  customerId: string,
  connectionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const added = await addGmailQuerySource(user.organizationId, customerId, {
      connectionId,
      query: formData.get("query"),
    });
    if (!added) return GONE;
    refresh();
    return { message: "Added." };
  });
}

export async function removeCustomerSourceAction(
  customerId: string,
  sourceId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const removed = await removeCustomerSource(
      user.organizationId,
      customerId,
      sourceId,
    );
    if (!removed) return { error: "This source no longer exists." };
    refresh();
  });
}

export async function syncCustomerSourceAction(
  customerId: string,
  sourceId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    // Check access now, so a refusal is reported instead of failing silently
    // in the background.
    const sources = await listCustomerSources(user.organizationId, customerId);
    if (!sources?.some((source) => source.id === sourceId)) {
      return { error: "This source no longer exists." };
    }
    // A sync can take minutes: run it after responding.
    after(async () => {
      try {
        await syncCustomerSource(user, customerId, sourceId);
      } catch (error) {
        console.error(`Sync of customer source ${sourceId} failed`, error);
      }
    });
    return { message: "Sync started. Reload to see progress." };
  });
}
