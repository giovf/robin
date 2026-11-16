"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import {
  deleteDocument,
  publishDocumentToConfluence,
  restoreDocumentVersion,
  saveDocument,
} from "@/lib/documents/documents";
import { runFormAction, type FormState } from "@/lib/form-action";
import { IntegrationError, isIntegrationEnabled } from "@/lib/integrations";
import { requireUser } from "@/lib/session";

const GONE: FormState = { error: "This document no longer exists." };

export async function saveDocumentAction(
  customerId: string,
  documentId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const version = await saveDocument(user.id, customerId, documentId, {
      title: formData.get("title"),
      content: formData.get("content"),
    });
    if (version === null) return GONE;
    refresh();
    return { message: `Saved — version ${version}.` };
  });
}

export async function restoreDocumentVersionAction(
  customerId: string,
  solutionId: string,
  documentId: string,
  version: number,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const restored = await restoreDocumentVersion(
      user.id,
      customerId,
      documentId,
      version,
    );
    if (restored === null) return GONE;
    redirect(
      `/customers/${customerId}/solutions/${solutionId}/documents/${documentId}`,
    );
  });
}

export async function deleteDocumentAction(
  customerId: string,
  solutionId: string,
  documentId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    await deleteDocument(user.id, customerId, documentId);
    redirect(`/customers/${customerId}/solutions/${solutionId}/documents`);
  });
}

export async function publishDocumentAction(
  customerId: string,
  solutionId: string,
  documentId: string,
  reviewedVersion: number,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    if (!isIntegrationEnabled("atlassian")) {
      return { error: "Publishing to Confluence is not switched on." };
    }
    // The select's value is "<connection id>|<space id>".
    const [connectionId = "", spaceId = ""] = String(
      formData.get("space") ?? "",
    ).split("|");
    try {
      await publishDocumentToConfluence(user, customerId, {
        documentId,
        reviewedVersion,
        connectionId,
        spaceId,
        pageTitle: formData.get("pageTitle"),
        confirmed: formData.get("confirm") === "yes",
      });
    } catch (error) {
      if (error instanceof IntegrationError) {
        return {
          error:
            error.status === 401 || error.status === 403
              ? "Confluence refused the request. Reconnect Atlassian with publishing access on the Integrations page, then try again."
              : "Confluence could not be reached. Nothing was published.",
        };
      }
      throw error;
    }
    redirect(
      `/customers/${customerId}/solutions/${solutionId}/documents/${documentId}?published=1`,
    );
  });
}
