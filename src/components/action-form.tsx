"use client";

import { useActionState, type ReactNode } from "react";

import type { FormState } from "@/lib/form-action";

import {
  dangerButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

const BUTTON_CLASS = {
  primary: primaryButtonClass,
  secondary: secondaryButtonClass,
  danger: dangerButtonClass,
} as const;

interface ActionFormProps {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  variant?: keyof typeof BUTTON_CLASS;
  /** The form's fields. */
  children?: ReactNode;
  className?: string;
}

/** A form bound to a server action, showing its error or success message. */
export function ActionForm({
  action,
  submitLabel,
  variant = "primary",
  children,
  className = "flex flex-col gap-4",
}: ActionFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      {state.error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger-soft text-danger rounded-control border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={BUTTON_CLASS[variant]}
        >
          {pending ? "Working…" : submitLabel}
        </button>
        <p role="status" className="text-success text-sm">
          {!pending && !state.error ? state.message : null}
        </p>
      </div>
    </form>
  );
}
