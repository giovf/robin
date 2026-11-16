import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { calls } from "./calls";
import { timestamps } from "./columns";

export const SUGGESTION_STATES = ["shown", "asked", "dismissed"] as const;
export type SuggestionState = (typeof SUGGESTION_STATES)[number];

/** A question the agent suggested during a live call. */
export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    rationale: text("rationale"),
    state: text("state", { enum: SUGGESTION_STATES })
      .default("shown")
      .notNull(),
    ...timestamps,
  },
  (t) => [index("suggestions_call_id_idx").on(t.callId)],
);

export type Suggestion = typeof suggestions.$inferSelect;
export type NewSuggestion = typeof suggestions.$inferInsert;
