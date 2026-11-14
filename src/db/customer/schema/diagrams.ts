import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { solutions } from "./solutions";

export const diagrams = pgTable(
  "diagrams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    solutionId: uuid("solution_id")
      .notNull()
      .references(() => solutions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Diagram-as-code source. */
    sourceCode: text("source_code").notNull(),
    /** Diagram language. Free text: the format is a PRD open question. */
    format: text("format").default("mermaid").notNull(),
    /** e.g. `architecture`, `sequence`, `flowchart`, `er`. */
    diagramType: text("diagram_type"),
    ...timestamps,
  },
  (t) => [index("diagrams_solution_id_idx").on(t.solutionId)],
);

export type Diagram = typeof diagrams.$inferSelect;
export type NewDiagram = typeof diagrams.$inferInsert;
