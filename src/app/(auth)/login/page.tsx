import type { Metadata } from "next";
import Link from "next/link";

import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-muted mt-1 text-sm">
          Your customers, calls and documents are waiting.
        </p>
      </div>
      <AuthForm mode="sign-in" action={signInAction} />
      <p className="text-muted text-sm">
        First time here?{" "}
        <Link href="/signup" className="text-accent font-medium underline">
          Create the account
        </Link>
      </p>
    </div>
  );
}
