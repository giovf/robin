import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, timestamps } from "./columns";

/**
 * This customer's agent instance configuration. Exactly one row (id = 1):
 * the database *is* the customer, so there is nothing to key it by.
 */
export const agentConfig = pgTable(
  "agent_config",
  {
    id: integer("id").primaryKey().default(1),
    /** Extra instructions appended to the base system prompt. */
    systemPromptOverride: text("system_prompt_override"),
    /** Model id to use instead of the application default. */
    modelOverride: text("model_override"),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...timestamps,
  },
  (t) => [check("agent_config_singleton", sql`${t.id} = 1`)],
);

export const AGENT_MEMORY_ROLES = ["user", "assistant", "system"] as const;
export type AgentMemoryRole = (typeof AGENT_MEMORY_ROLES)[number];

/** The agent's conversation memory, grouped into sessions. */
export const agentMemory = pgTable(
  "agent_memory",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: text("session_id").notNull(),
    role: text("role", { enum: AGENT_MEMORY_ROLES }).notNull(),
    content: text("content").notNull(),
    /** e.g. ids of the chunks retrieved for this turn. */
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    /** Order of the turn within its session. */
    sequence: integer("sequence").notNull(),
    createdAt,
  },
  (t) => [
    unique("agent_memory_session_sequence_unique").on(t.sessionId, t.sequence),
    index("agent_memory_session_id_idx").on(t.sessionId),
  ],
);

export type AgentConfig = typeof agentConfig.$inferSelect;
export type NewAgentConfig = typeof agentConfig.$inferInsert;
export type AgentMemoryEntry = typeof agentMemory.$inferSelect;
export type NewAgentMemoryEntry = typeof agentMemory.$inferInsert;
