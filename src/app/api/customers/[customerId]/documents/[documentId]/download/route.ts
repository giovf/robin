import { CustomerConnectionError } from "@/lib/customer-connection";
import { getDocument } from "@/lib/documents/documents";
import { documentFileName } from "@/lib/documents/outline";
import { getUserFromHeaders } from "@/lib/session";

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Downloads a document's latest version (or `?v=N`) as a Markdown file. */
export async function GET(
  request: Request,
  context: RouteContext<"/api/customers/[customerId]/documents/[documentId]/download">,
): Promise<Response> {
  const user = await getUserFromHeaders(request.headers);
  if (!user) return json(401, { error: "Not signed in." });

  const { customerId, documentId } = await context.params;
  const wanted = new URL(request.url).searchParams.get("v");
  try {
    const detail = await getDocument(
      user.id,
      customerId,
      documentId,
      wanted === null ? undefined : Number(wanted),
    );
    if (!detail) return json(404, { error: "Document not found." });
    return new Response(detail.version.content, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${documentFileName(detail.document.title, "md")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // Missing, archived and someone else's customer all look the same.
    if (error instanceof CustomerConnectionError) {
      return json(404, { error: "Document not found." });
    }
    throw error;
  }
}
