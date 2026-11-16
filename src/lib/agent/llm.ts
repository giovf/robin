import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

/*
 * The language model behind the agent, as a narrow interface so it can be
 * faked in tests (no network, no cost) and swapped.
 */

export const DEFAULT_AGENT_MODEL = "claude-opus-5-5";

export type LlmEffort = "low" | "medium" | "high";

export interface LlmRequest {
  /** Model id; defaults to DEFAULT_AGENT_MODEL. */
  model?: string;
  /** Stable instructions. Kept free of per-request data so it can be cached. */
  system: string;
  /** The per-request content. */
  prompt: string;
  /** How hard the model should think: low for live suggestions, high for documents. */
  effort: LlmEffort;
  maxTokens: number;
}

export interface LlmClient {
  /** A reply constrained to `schema`. */
  generateJson<Schema extends z.ZodType>(
    request: LlmRequest,
    schema: Schema,
  ): Promise<z.infer<Schema>>;
  /** A free-text reply; `onText` receives it piece by piece as it streams. */
  generateText(
    request: LlmRequest,
    onText?: (delta: string) => void,
  ): Promise<string>;
}

export type LlmFailure =
  | "not_configured"
  | "refused"
  | "truncated"
  | "invalid_output"
  | "rate_limited"
  | "unavailable";

/** The model call did not produce a usable answer. */
export class LlmError extends Error {
  constructor(
    public readonly reason: LlmFailure,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** Lets a refused request be re-run on Anthropic's default fallback model. */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

function toLlmError(error: unknown): unknown {
  if (error instanceof Anthropic.AuthenticationError) {
    return new LlmError(
      "not_configured",
      "The Anthropic API key was rejected.",
    );
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError(
      "rate_limited",
      "The model is rate limited; try again.",
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new LlmError("unavailable", "Could not reach the model.");
  }
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) {
    return new LlmError("unavailable", "The model is temporarily unavailable.");
  }
  return error;
}

function checkStop(stopReason: string | null): void {
  if (stopReason === "refusal") {
    throw new LlmError("refused", "The model declined this request.");
  }
  if (stopReason === "max_tokens") {
    throw new LlmError("truncated", "The model's answer was cut off.");
  }
}

/** Claude through the Anthropic API. Every call costs money. */
export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  private params(request: LlmRequest) {
    return {
      model: request.model ?? DEFAULT_AGENT_MODEL,
      max_tokens: request.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: "default" as const,
      // Thinking is adaptive by default on this model; effort is the control.
      output_config: { effort: request.effort },
      system: [
        {
          type: "text" as const,
          text: request.system,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      messages: [{ role: "user" as const, content: request.prompt }],
    };
  }

  async generateJson<Schema extends z.ZodType>(
    request: LlmRequest,
    schema: Schema,
  ): Promise<z.infer<Schema>> {
    const params = this.params(request);
    try {
      const response = await this.client.beta.messages.parse({
        ...params,
        output_config: {
          ...params.output_config,
          format: betaZodOutputFormat(schema),
        },
      });
      checkStop(response.stop_reason);
      if (response.parsed_output === null) {
        throw new LlmError(
          "invalid_output",
          "The model's answer was malformed.",
        );
      }
      return response.parsed_output;
    } catch (error) {
      throw toLlmError(error);
    }
  }

  async generateText(
    request: LlmRequest,
    onText?: (delta: string) => void,
  ): Promise<string> {
    try {
      const stream = this.client.beta.messages.stream(this.params(request));
      if (onText) stream.on("text", onText);
      const message = await stream.finalMessage();
      checkStop(message.stop_reason);
      return message.content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
    } catch (error) {
      throw toLlmError(error);
    }
  }
}

let client: LlmClient | undefined;

/** @throws LlmError("not_configured") when ROBIN_ANTHROPIC_API_KEY is unset. */
export function getLlmClient(): LlmClient {
  if (!client) {
    // ROBIN_ANTHROPIC_API_KEY lets the app use a different key from the
    // developer tooling; ANTHROPIC_API_KEY is the fallback.
    const apiKey =
      process.env.ROBIN_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LlmError(
        "not_configured",
        "The AI agent is not configured: set ROBIN_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY).",
      );
    }
    client = new AnthropicLlmClient(apiKey);
  }
  return client;
}

/** Replaces the client (tests). */
export function setLlmClient(next: LlmClient | undefined): void {
  client = next;
}
