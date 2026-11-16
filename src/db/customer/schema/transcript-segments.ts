import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { calls } from "./calls";
import { createdAt } from "./columns";

export const transcriptSegments = pgTable(
  "transcript_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id, { onDelete: "cascade" }),
    speaker: text("speaker").notNull(),
    text: text("text").notNull(),
    /** Milliseconds from the start of the call. */
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    /** Delivery id of the webhook that carried this segment; makes retries harmless. */
    deliveryId: text("delivery_id").unique(),
    createdAt,
  },
  (t) => [index("transcript_segments_call_start_idx").on(t.callId, t.startMs)],
);

export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type NewTranscriptSegment = typeof transcriptSegments.$inferInsert;
