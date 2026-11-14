"use server";

import { redirect } from "next/navigation";

import { runFormAction, type FormState } from "@/lib/form-action";
import { deleteSourceItem } from "@/lib/knowledge";
import { requireUser } from "@/lib/session";

export async function deleteSourceItemAction(
  customerId: string,
  sourceItemId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    await deleteSourceItem(user.id, customerId, sourceItemId);
    redirect(`/customers/${customerId}/knowledge`);
  });
}
