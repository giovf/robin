import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE_SECONDS,
  startOAuth,
} from "@/lib/integrations/oauth-flow";
import { getUserFromHeaders } from "@/lib/session";

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
  });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** Starts connecting an integration: redirects the user to the provider. */
export async function GET(
  request: Request,
  context: RouteContext<"/api/integrations/[provider]/authorize">,
): Promise<Response> {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return redirect("/login");

  const { provider } = await context.params;
  const start = startOAuth(provider);
  if (!start.ok) return redirect(`/integrations?error=${start.error}`);

  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(
    start.authorizationUrl,
    `${OAUTH_STATE_COOKIE}=${start.state}; Path=/api/integrations; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}${secure}`,
  );
}
