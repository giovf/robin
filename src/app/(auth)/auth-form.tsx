"use client";

import { useActionState } from "react";

import { inputClass, labelClass, primaryButtonClass } from "@/components/ui";

import type { AuthFormState } from "./actions";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  minPasswordLength?: number;
}

export function AuthForm({ mode, action, minPasswordLength }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const signUp = mode === "sign-up";

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state.error ? (
        <p
          role="alert"
          className="border-danger/30 bg-danger-soft text-danger rounded-control border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}

      {signUp ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className={labelClass}>
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            defaultValue={state.name}
            className={inputClass}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={signUp ? "new-password" : "current-password"}
          required
          minLength={signUp ? minPasswordLength : undefined}
          aria-describedby={signUp ? "password-hint" : undefined}
          className={inputClass}
        />
        {signUp ? (
          <p id="password-hint" className="text-muted text-xs">
            At least {minPasswordLength} characters.
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending
          ? signUp
            ? "Creating account…"
            : "Signing in…"
          : signUp
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
