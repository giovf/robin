import type { z } from "zod";

import type { LlmClient, LlmRequest } from "./llm";

/**
 * An LlmClient for tests: records every request and answers from canned
 * values. No network, no cost.
 */
export class FakeLlmClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  json: unknown = { suggestions: [] };
  text = "# Draft\n\nBody [S1].";
  error: Error | undefined;

  async generateJson<Schema extends z.ZodType>(
    request: LlmRequest,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    this.requests.push(request);
    if (this.error) throw this.error;
    return schema.parse(this.json);
  }

  async generateText(
    request: LlmRequest,
    onText?: (delta: string) => void,
  ): Promise<string> {
    this.requests.push(request);
    if (this.error) throw this.error;
    for (const word of this.text.split(/(?<= )/)) onText?.(word);
    return this.text;
  }
}
