import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { solutions } from "./solutions";

export const CALL_BOT_STATUSES = [
  "creating",
  "joining",
  "in_call",
  "leaving",
  "left",
  "error",
] as const;
export type CallBotStatus = (typeof CALL_BOT_STATUSES)[number];

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutions.id, { onDelete: "cascade" }),
    title: text("title"),
    meetingUrl: text("meeting_url").notNull(),
    /** Meeting-bot provider's bot identifier (Recall.ai). */
    botId: text("bot_id").unique(),
    botStatus: text("bot_status", { enum: CALL_BOT_STATUSES }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Why the bot failed or left, as reported by the provider (a code, not content). */
    botStatusDetail: text("bot_status_detail"),
    /** When the finished transcript was added to the customer's searchable context. */
    transcriptIndexedAt: timestamp("transcript_indexed_at", {
      withTimezone: true,
    }),
    /** The user confirmed the recording-consent reminder before the bot joined. */
    consentAcknowledged: boolean("consent_acknowledged")
      .default(false)
      .notNull(),
    consentAcknowledgedAt: timestamp("consent_acknowledged_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => [index("calls_solution_id_idx").on(t.solutionId)],
);

export type CallRecord = typeof calls.$inferSelect;
export type NewCallRecord = typeof calls.$inferInsert;
