import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";

export const SOLUTION_STATUSES = [
  "active",
  "going_ahead",
  "completed",
  "archived",
] as const;
export type SolutionStatus = (typeof SOLUTION_STATUSES)[number];

/** Phase every new solution starts in. The full phase list is a PRD open question. */
export const DEFAULT_SOLUTION_PHASE = "discovery";

export const solutions = pgTable("solutions", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Free text until the life-cycle phase list is settled. */
  currentPhase: text("current_phase").default(DEFAULT_SOLUTION_PHASE).notNull(),
  status: text("status", { enum: SOLUTION_STATUSES })
    .default("active")
    .notNull(),
  ...timestamps,
});

export type Solution = typeof solutions.$inferSelect;
export type NewSolution = typeof solutions.$inferInsert;
