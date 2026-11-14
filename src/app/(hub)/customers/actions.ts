"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";

import {
  archiveCustomer,
  createCustomer,
  deleteCustomer,
  getCustomer,
  renameCustomer,
  restoreCustomer,
} from "@/lib/customers";
import { runFormAction, type FormState } from "@/lib/form-action";
import { requireUser } from "@/lib/session";

export async function createCustomerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const customer = await createCustomer(user.organizationId, {
      name: formData.get("name"),
    });
    redirect(`/customers/${customer.id}`);
  });
}

export async function renameCustomerAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const renamed = await renameCustomer(user.organizationId, customerId, {
      name: formData.get("name"),
    });
    if (!renamed) return { error: "This customer is not available." };
    refresh();
    return { message: "Saved." };
  });
}

export async function archiveCustomerAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const customer = await getCustomer(user.organizationId, customerId);
    if (!customer) return { error: "This customer is not available." };
    if (formData.get("confirm") !== customer.name) {
      return { error: "Type the customer's name exactly to confirm." };
    }
    await archiveCustomer(user.organizationId, customerId);
    redirect("/customers");
  });
}

export async function restoreCustomerAction(
  customerId: string,
  _previous: FormState,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    if (!(await restoreCustomer(user.organizationId, customerId))) {
      return { error: "This customer is not available." };
    }
    redirect(`/customers/${customerId}`);
  });
}

export async function deleteCustomerAction(
  customerId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  return runFormAction(async () => {
    const user = await requireUser();
    const deleted = await deleteCustomer(
      user.organizationId,
      customerId,
      formData.get("confirm-delete"),
    );
    if (!deleted) return { error: "This customer is not available." };
    redirect("/customers");
  });
}
