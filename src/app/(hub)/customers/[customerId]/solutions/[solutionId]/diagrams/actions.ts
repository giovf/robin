"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import { LlmError } from "@/lib/agent/llm";
import { deleteDiagram, generateDiagram, saveDiagram } from "@/lib/diagrams";
import { runFormAction, type FormState } from "@/lib/form-action";
import { requireUser } from "@/lib/session";

export async function generateDiagramAction(
  customerId: string,
  solutionId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    let diagramId: string;
    try {
      const diagram = await generateDiagram(user.id, customerId, {
        solutionId,
        type: formData.get("type"),
        brief: formData.get("brief"),
      });
      diagramId = diagram.id;
    } catch (error) {
      if (error instanceof LlmError) {
        return {
          error:
            error.reason === "not_configured"
              ? "The AI agent is not configured (no Anthropic API key)."
              : "Robin could not draw this diagram just now. Try again.",
        };
      }
      throw error;
    }
    redirect(
      `/customers/${customerId}/solutions/${solutionId}/diagrams/${diagramId}`,
    );
  });
}

export async function saveDiagramAction(
  customerId: string,
  diagramId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const saved = await saveDiagram(user.id, customerId, diagramId, {
      title: formData.get("title"),
      sourceCode: formData.get("sourceCode"),
    });
    if (!saved) return { error: "This diagram no longer exists." };
    refresh();
    return { message: "Saved." };
  });
}

export async function deleteDiagramAction(
  customerId: string,
  solutionId: string,
  diagramId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    await deleteDiagram(user.id, customerId, diagramId);
    redirect(`/customers/${customerId}/solutions/${solutionId}/diagrams`);
  });
}
