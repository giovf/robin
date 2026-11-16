import { after } from "next/server";

import {
  getLiveCallState,
  maybeGenerateSuggestions,
  refreshCallStatus,
} from "@/lib/calls/calls";
import { CustomerConnectionError } from "@/lib/customer-connection";
import { getUserFromHeaders } from "@/lib/session";

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * Polled by the live call screen: new transcript segments since `after`, the
 * current suggestions and the call's status. While the call is active, a poll
 * also (in the background) lets the agent suggest questions when enough new
 * has been said — so suggestions are only generated while someone watches.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/customers/[customerId]/calls/[callId]/live">,
): Promise<Response> {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return json(401, { error: "Not signed in." });
  const { customerId, callId } = await context.params;
  const query = new URL(request.url).searchParams;

  try {
    if (query.get("refresh") === "1") {
      await refreshCallStatus(user.id, customerId, callId);
    }
    const state = await getLiveCallState(
      user.id,
      customerId,
      callId,
      query.get("after") ?? undefined,
    );
    if (!state) return json(404, { error: "Call not found." });
    if (state.active) {
      after(async () => {
        try {
          await maybeGenerateSuggestions(user.id, customerId, callId);
        } catch (error) {
          console.error(`Suggestions for call ${callId} failed`, error);
        }
      });
    }
    return json(200, state);
  } catch (error) {
    if (error instanceof CustomerConnectionError) {
      return json(404, { error: "Call not found." });
    }
    throw error;
  }
}
