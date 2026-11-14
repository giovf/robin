"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { runFormAction, type FormState } from "@/lib/form-action";
import { requireUser } from "@/lib/session";
import {
  createSolution,
  setSolutionPhase,
  setSolutionStatus,
  updateSolution,
} from "@/lib/solutions";

const GONE: FormState = { error: "This solution no longer exists." };

export async function createSolutionAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const solution = await createSolution(user.id, customerId, {
      name: formData.get("name"),
      description: formData.get("description"),
    });
    redirect(`/customers/${customerId}/solutions/${solution.id}`);
  });
}

export async function updateSolutionAction(
  customerId: string,
  solutionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const solution = await updateSolution(user.id, customerId, solutionId, {
      name: formData.get("name"),
      description: formData.get("description"),
    });
    if (!solution) return GONE;
    refresh();
    return { message: "Saved." };
  });
}

export async function setSolutionPhaseAction(
  customerId: string,
  solutionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const solution = await setSolutionPhase(
      user.id,
      customerId,
      solutionId,
      formData.get("phase"),
    );
    if (!solution) return GONE;
    refresh();
    return { message: "Phase updated." };
  });
}

export async function setSolutionStatusAction(
  customerId: string,
  solutionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const status = formData.get("status");
    const solution = await setSolutionStatus(
      user.id,
      customerId,
      solutionId,
      status,
    );
    if (!solution) return GONE;
    if (status === "archived") redirect(`/customers/${customerId}/solutions`);
    refresh();
    return { message: "Status updated." };
  });
}
