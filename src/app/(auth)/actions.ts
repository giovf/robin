"use server";

import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth, MIN_PASSWORD_LENGTH } from "@/lib/auth";

export interface AuthFormState {
  error?: string;
  /** Echoed back so the form keeps what the user typed. */
  email?: string;
  name?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signInAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  if (!email || !password) {
    return { email, error: "Enter your email and password." };
  }
  try {
    await getAuth().api.signInEmail({ body: { email, password } });
  } catch (error) {
    if (error instanceof APIError) {
      // Deliberately the same message for unknown email and wrong password.
      return { email, error: "Email or password is incorrect." };
    }
    throw error;
  }
  redirect("/");
}

export async function signUpAction(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = field(formData, "name").trim();
  const email = field(formData, "email").trim();
  const password = field(formData, "password");
  if (!name || !email) {
    return { name, email, error: "Enter your name and email." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      name,
      email,
      error: `Use a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  try {
    await getAuth().api.signUpEmail({ body: { name, email, password } });
  } catch (error) {
    if (error instanceof APIError) {
      const message =
        error.status === "FORBIDDEN"
          ? "Sign-up is closed. Ask the account owner for access."
          : "Could not create the account. Check the details and try again.";
      return { name, email, error: message };
    }
    throw error;
  }
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
