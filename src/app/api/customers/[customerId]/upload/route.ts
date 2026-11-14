import { CustomerConnectionError } from "@/lib/customer-connection";
import { uploadFile } from "@/lib/ingestion/upload";
import { getUserFromHeaders } from "@/lib/session";
import { MAX_UPLOAD_BYTES } from "@/lib/text-extraction";
import { ValidationError } from "@/lib/validation";

function json(status: number, body: unknown): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** A browser sends Origin on cross-site POSTs; refuse those (CSRF). */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

/**
 * Adds one uploaded file (multipart field `file`) to a customer's context.
 * Responds with JSON: `{ title, chunkCount, changed }` or `{ error }`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/customers/[customerId]/upload">,
): Promise<Response> {
  if (!sameOrigin(request)) return json(403, { error: "Forbidden." });
  const user = await getUserFromHeaders(request.headers);
  if (!user) return json(401, { error: "Not signed in." });

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return json(413, { error: "The file is too large." });
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return json(400, { error: "Expected a file upload." });
  }
  if (!(file instanceof File)) {
    return json(400, { error: "Choose a file to upload." });
  }

  const { customerId } = await context.params;
  try {
    const result = await uploadFile(user.id, customerId, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    return json(200, {
      title: result.sourceItem.title,
      chunkCount: result.chunkCount,
      changed: result.changed,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return json(422, { error: error.message });
    }
    if (error instanceof CustomerConnectionError) {
      return json(404, { error: "Customer not found." });
    }
    throw error;
  }
}
