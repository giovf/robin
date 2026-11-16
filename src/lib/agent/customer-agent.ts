import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import {
  agentConfig,
  agentMemory,
  type AgentConfig,
  type AgentMemoryEntry,
  type AgentMemoryRole,
  type DocumentCitation,
} from "@/db/customer/schema";

import {
  CustomerNotFoundError,
  getCustomerConnection,
} from "../customer-connection";
import { retrieveContext, type RetrievalResult } from "../retrieval";
import { getSolution } from "../solutions";
import { optionalText, ValidationError } from "../validation";
import { getLlmClient } from "./llm";
import {
  buildDiagramPrompt,
  buildDocumentPrompt,
  buildSuggestionsPrompt,
  DIAGRAM_SYSTEM_PROMPT,
  DOCUMENT_SYSTEM_PROMPT,
  SUGGESTIONS_SYSTEM_PROMPT,
  type DiagramTypeId,
} from "./prompts";

/*
 * One agent per customer. An agent is bound to a (user, customer) pair and
 * reaches data only through the customer-connection resolver — its
 * configuration, memory and retrieval all live in that customer's database,
 * so nothing about another customer can enter a prompt.
 */

export const MAX_SUGGESTIONS = 3;
/** Only the latest part of a long call is sent with each suggestion request. */
const TRANSCRIPT_WINDOW_CHARS = 6000;
const SUGGESTION_CONTEXT_CHUNKS = 6;
const DOCUMENT_CONTEXT_CHUNKS = 20;
const DIAGRAM_CONTEXT_CHUNKS = 12;
const INSTRUCTIONS_MAX_LENGTH = 4000;
const MODEL_MAX_LENGTH = 100;

const suggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      question: z.string(),
      rationale: z.string(),
    }),
  ),
});

export interface SuggestedQuestion {
  question: string;
  rationale: string;
}

export interface DraftedDocument {
  /** Markdown, citing sources as [S1], [S2]… */
  content: string;
  /** What each [S…] marker refers to. */
  citations: DocumentCitation[];
}

function toCitations(results: RetrievalResult[]): DocumentCitation[] {
  return results.map((result, index) => ({
    location: `S${index + 1}`,
    chunkId: result.chunkId,
    ...(result.source.type === "source_item"
      ? { sourceItemId: result.source.id }
      : { callId: result.source.id }),
  }));
}

export class CustomerAgent {
  constructor(
    private readonly userId: string,
    readonly customerId: string,
    private readonly config: AgentConfig | undefined,
  ) {}

  private get model(): string | undefined {
    return this.config?.modelOverride ?? undefined;
  }

  private async solution(solutionId: string) {
    const solution = await getSolution(
      this.userId,
      this.customerId,
      solutionId,
    );
    if (!solution) throw new ValidationError("This solution does not exist.");
    return solution;
  }

  /**
   * Questions the architect could ask next, given the recent transcript of a
   * live call about one of this customer's solutions.
   *
   * @throws LlmError, ValidationError, CustomerConnectionError
   */
  async suggestQuestions(input: {
    solutionId: string;
    transcript: string;
    /** Questions already suggested in this call, so they are not repeated. */
    alreadySuggested?: string[];
  }): Promise<SuggestedQuestion[]> {
    const transcript = input.transcript.trim().slice(-TRANSCRIPT_WINDOW_CHARS);
    if (!transcript) return [];
    const solution = await this.solution(input.solutionId);
    const context = await retrieveContext(
      this.userId,
      this.customerId,
      transcript,
      { limit: SUGGESTION_CONTEXT_CHUNKS },
    );
    const result = await getLlmClient().generateJson(
      {
        model: this.model,
        system: SUGGESTIONS_SYSTEM_PROMPT,
        prompt: buildSuggestionsPrompt({
          solution,
          transcript,
          context,
          maxSuggestions: MAX_SUGGESTIONS,
          instructions: this.config?.systemPromptOverride ?? null,
          alreadySuggested: input.alreadySuggested,
        }),
        // Live: the answer has to arrive while it is still relevant.
        effort: "low",
        maxTokens: 2000,
      },
      suggestionsSchema,
    );
    return result.suggestions
      .map((suggestion) => ({
        question: suggestion.question.trim(),
        rationale: suggestion.rationale.trim(),
      }))
      .filter((suggestion) => suggestion.question)
      .slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Drafts a document for one of this customer's solutions from retrieved
   * context. `onText` receives the draft as it is written.
   *
   * @throws LlmError, ValidationError, CustomerConnectionError
   */
  async draftDocument(
    input: { solutionId: string; title: string; brief: string },
    onText?: (delta: string) => void,
  ): Promise<DraftedDocument> {
    const solution = await this.solution(input.solutionId);
    const context = await retrieveContext(
      this.userId,
      this.customerId,
      `${input.title}\n${input.brief}\n${solution.name}\n${solution.description ?? ""}`,
      { limit: DOCUMENT_CONTEXT_CHUNKS },
    );
    const content = await getLlmClient().generateText(
      {
        model: this.model,
        system: DOCUMENT_SYSTEM_PROMPT,
        prompt: buildDocumentPrompt({
          solution,
          documentTitle: input.title,
          brief: input.brief,
          context,
          instructions: this.config?.systemPromptOverride ?? null,
        }),
        effort: "high",
        maxTokens: 32000,
      },
      onText,
    );
    return { content: content.trim(), citations: toCitations(context) };
  }

  /**
   * Draws a diagram of one of this customer's solutions as Mermaid code.
   *
   * @throws LlmError, ValidationError, CustomerConnectionError
   */
  async generateDiagram(input: {
    solutionId: string;
    type: DiagramTypeId;
    brief: string | null;
  }): Promise<string> {
    const solution = await this.solution(input.solutionId);
    const context = await retrieveContext(
      this.userId,
      this.customerId,
      `${input.type} diagram ${input.brief ?? ""}\n${solution.name}\n${solution.description ?? ""}`,
      { limit: DIAGRAM_CONTEXT_CHUNKS },
    );
    const text = await getLlmClient().generateText({
      model: this.model,
      system: DIAGRAM_SYSTEM_PROMPT,
      prompt: buildDiagramPrompt({
        solution,
        type: input.type,
        brief: input.brief,
        context,
        instructions: this.config?.systemPromptOverride ?? null,
      }),
      effort: "medium",
      maxTokens: 8000,
    });
    // Models sometimes add a code fence despite being told not to.
    return text
      .trim()
      .replace(/^```(?:mermaid)?\s*\n/, "")
      .replace(/\n```\s*$/, "")
      .trim();
  }

  // ── Memory: conversation turns, stored in the customer's database ───────

  /** Appends a turn to a session and returns it. */
  async remember(
    sessionId: string,
    role: AgentMemoryRole,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<AgentMemoryEntry> {
    const db = await getCustomerConnection(this.userId, this.customerId);
    return db.transaction(async (tx) => {
      const [last] = await tx
        .select({ value: max(agentMemory.sequence) })
        .from(agentMemory)
        .where(eq(agentMemory.sessionId, sessionId));
      const [entry] = await tx
        .insert(agentMemory)
        .values({
          sessionId,
          role,
          content,
          metadata,
          sequence: (last?.value ?? -1) + 1,
        })
        .returning();
      return entry;
    });
  }

  /** A session's turns, oldest first. */
  async recall(sessionId: string): Promise<AgentMemoryEntry[]> {
    const db = await getCustomerConnection(this.userId, this.customerId);
    return db
      .select()
      .from(agentMemory)
      .where(eq(agentMemory.sessionId, sessionId))
      .orderBy(asc(agentMemory.sequence));
  }

  async forget(sessionId: string): Promise<void> {
    const db = await getCustomerConnection(this.userId, this.customerId);
    await db.delete(agentMemory).where(eq(agentMemory.sessionId, sessionId));
  }
}

/** This customer's agent configuration, or undefined if never set. */
export async function getAgentConfig(
  userId: string,
  customerId: string,
): Promise<AgentConfig | undefined> {
  const db = await getCustomerConnection(userId, customerId);
  const [config] = await db.select().from(agentConfig).limit(1);
  return config;
}

/** @throws ValidationError */
export async function updateAgentConfig(
  userId: string,
  customerId: string,
  input: { instructions?: unknown; model?: unknown },
): Promise<AgentConfig> {
  const values = {
    systemPromptOverride: optionalText(
      input.instructions,
      "Instructions",
      INSTRUCTIONS_MAX_LENGTH,
    ),
    modelOverride: optionalText(input.model, "Model", MODEL_MAX_LENGTH),
  };
  const db = await getCustomerConnection(userId, customerId);
  const [config] = await db
    .insert(agentConfig)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: agentConfig.id, set: values })
    .returning();
  return config;
}

/**
 * The agent for one customer, acting for one user.
 *
 * @throws CustomerConnectionError if the user may not access the customer.
 */
export async function getCustomerAgent(
  userId: string,
  customerId: string,
): Promise<CustomerAgent> {
  if (!customerId) throw new CustomerNotFoundError(customerId);
  const config = await getAgentConfig(userId, customerId);
  return new CustomerAgent(userId, customerId, config);
}
