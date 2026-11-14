import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect only: sends visitors without a session cookie to the
 * login page before any rendering happens. It does NOT validate the session —
 * every page, action and route handler still checks it (see `@/lib/session`).
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  // Everything except auth pages, API routes (they answer 401 themselves),
  // Next internals and static files.
  matcher: ["/((?!login|signup|api|_next/static|_next/image|.*\\..*).*)"],
};
