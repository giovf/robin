import { signOutAction } from "@/app/(auth)/actions";
import { requireUser } from "@/lib/session";

/** Who is signed in, with sign out. Reads the session: render inside Suspense. */
export async function UserMenu() {
  const user = await requireUser();
  const label = user.name || user.email;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="bg-accent-soft text-accent flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
      >
        {label.charAt(0).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-muted hover:text-ink text-xs underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
