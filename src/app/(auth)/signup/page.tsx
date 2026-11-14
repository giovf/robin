import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { isSignUpOpen, MIN_PASSWORD_LENGTH } from "@/lib/auth";

import { signUpAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

async function SignUpPanel() {
  await connection();
  if (!(await isSignUpOpen())) {
    return (
      <p className="bg-sunken rounded-control px-3 py-2 text-sm">
        Sign-up is closed: this Robin already has its account. Sign in instead.
      </p>
    );
  }
  return (
    <AuthForm
      mode="sign-up"
      action={signUpAction}
      minPasswordLength={MIN_PASSWORD_LENGTH}
    />
  );
}

export default function SignUpPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create account</h1>
        <p className="text-muted mt-1 text-sm">
          Sets up your login and your organisation.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted text-sm">Loading…</p>}>
        <SignUpPanel />
      </Suspense>
      <p className="text-muted text-sm">
        Already set up?{" "}
        <Link href="/login" className="text-accent font-medium underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
