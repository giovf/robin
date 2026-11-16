import { Suspense, type ReactNode } from "react";

import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/session";

/** Renders its children only for a signed-in user; otherwise redirects. */
async function SignedIn({ children }: { children: ReactNode }) {
  await requireUser();
  return children;
}

export default function HubLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col md:flex-row">
      <a
        href="#main"
        className="bg-accent text-on-accent rounded-control sr-only z-10 px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <Sidebar />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-8">
          <Suspense fallback={<p className="text-muted text-sm">Loading…</p>}>
            <SignedIn>{children}</SignedIn>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
