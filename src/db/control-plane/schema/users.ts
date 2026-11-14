import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stored lower-cased; uniqueness is case-sensitive at the database level. */
  email: text("email").notNull().unique(),
  name: text("name"),
  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
