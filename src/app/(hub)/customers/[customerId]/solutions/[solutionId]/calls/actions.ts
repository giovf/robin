"use server";

import { redirect } from "next/navigation";

import { endCall, setSuggestionState, startCall } from "@/lib/calls/calls";
import { runFormAction, type FormState } from "@/lib/form-action";
import { requireUser } from "@/lib/session";

export async function startCallAction(
  customerId: string,
  solutionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const call = await startCall(user.id, customerId, {
      solutionId,
      meetingUrl: formData.get("meetingUrl"),
      title: formData.get("title"),
      consentAcknowledged: formData.get("consent") === "yes",
    });
    redirect(
      `/customers/${customerId}/solutions/${solutionId}/calls/${call.id}`,
    );
  });
}

export async function endCallAction(
  customerId: string,
  callId: string,
): Promise<void> {
  const user = await requireUser();
  await endCall(user.id, customerId, callId);
}

export async function setSuggestionStateAction(
  customerId: string,
  callId: string,
  suggestionId: string,
  state: "shown" | "asked" | "dismissed",
): Promise<void> {
  const user = await requireUser();
  await setSuggestionState(user.id, customerId, callId, suggestionId, state);
}
