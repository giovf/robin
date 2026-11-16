import { LlmError } from "@/lib/agent/llm";
import { CustomerConnectionError } from "@/lib/customer-connection";
import { generateDocument } from "@/lib/documents/documents";
import { getUserFromHeaders } from "@/lib/session";
import { ValidationError } from "@/lib/validation";

/** Separates the streamed draft from the final JSON result line. */
const RESULT_MARKER = "\u001e";

const LLM_MESSAGES: Record<LlmError["reason"], string> = {
  not_configured: "The AI agent is not configured (no Anthropic API key).",
  refused: "The model declined to write this document.",
  truncated: "The draft was cut off before it finished. Try again.",
  invalid_output: "The model's answer was malformed. Try again.",
  rate_limited: "The model is rate limited right now. Try again in a minute.",
  unavailable: "The model could not be reached. Try again.",
};

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
 * Drafts a document with the customer's agent. The response streams the draft
 * as plain text while it is written, then ends with a record separator and one
 * JSON line: `{ "documentId": … }` or `{ "error": … }`.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/customers/[customerId]/solutions/[solutionId]/documents/generate">,
): Promise<Response> {
  if (!sameOrigin(request)) return new Response("Forbidden.", { status: 403 });
  const user = await getUserFromHeaders(request.headers);
  if (!user) return new Response("Not signed in.", { status: 401 });
  const { customerId, solutionId } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  const templateId =
    typeof body === "object" && body !== null && "templateId" in body
      ? body.templateId
      : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string): void =>
        controller.enqueue(encoder.encode(text));
      let result: { documentId: string } | { error: string };
      try {
        const document = await generateDocument(
          user.id,
          customerId,
          { solutionId, templateId },
          send,
        );
        result = { documentId: document.id };
      } catch (error) {
        if (error instanceof ValidationError) {
          result = { error: error.message };
        } else if (error instanceof LlmError) {
          result = { error: LLM_MESSAGES[error.reason] };
        } else if (error instanceof CustomerConnectionError) {
          result = { error: "This customer is not available." };
        } else {
          console.error("Document generation failed", error);
          result = { error: "Something went wrong while drafting." };
        }
      }
      send(RESULT_MARKER + JSON.stringify(result));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
