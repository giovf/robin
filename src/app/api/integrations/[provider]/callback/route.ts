import {
  completeOAuth,
  OAUTH_STATE_COOKIE,
} from "@/lib/integrations/oauth-flow";
import { getUserFromHeaders } from "@/lib/session";

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: [
      ["Location", location],
      ["Cache-Control", "no-store"],
      // The state is single-use.
      [
        "Set-Cookie",
        `${OAUTH_STATE_COOKIE}=; Path=/api/integrations; HttpOnly; SameSite=Lax; Max-Age=0`,
      ],
    ],
  });
}

function cookie(request: Request, name: string): string | undefined {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = pair.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

/** The provider sends the user back here after they grant (or refuse) access. */
export async function GET(
  request: Request,
  context: RouteContext<"/api/integrations/[provider]/callback">,
): Promise<Response> {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return redirect("/login");

  const { provider } = await context.params;
  const result = await completeOAuth({
    provider,
    user,
    query: new URL(request.url).searchParams,
    expectedState: cookie(request, OAUTH_STATE_COOKIE),
  });
  return redirect(
    result.ok
      ? `/integrations?connected=${encodeURIComponent(provider)}`
      : `/integrations?error=${result.error}`,
  );
}
