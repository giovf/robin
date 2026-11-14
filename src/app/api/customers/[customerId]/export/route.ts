import { CustomerConnectionError } from "@/lib/customer-connection";
import { exportCustomerData } from "@/lib/customer-export";
import { getUserFromHeaders } from "@/lib/session";

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Downloads everything Robin holds about one customer as a JSON file. */
export async function GET(
  request: Request,
  context: RouteContext<"/api/customers/[customerId]/export">,
): Promise<Response> {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return json(401, { error: "Not signed in." });

  const { customerId } = await context.params;
  try {
    const data = await exportCustomerData(user, customerId);
    const slug =
      data.customer.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "customer";
    const date = data.exportedAt.toISOString().slice(0, 10);
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="robin-export-${slug}-${date}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Missing, archived and someone else's customer all look the same.
    if (error instanceof CustomerConnectionError) {
      return json(404, { error: "Customer not found." });
    }
    throw error;
  }
}
