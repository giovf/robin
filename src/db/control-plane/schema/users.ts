import { boolean, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";

/**
 * A person who can sign in. Also the `user` model of the auth library
 * (better-auth), which owns `emailVerified` and `image`.
 */
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  /** Stored lower-cased; uniqueness is case-sensitive at the database level. */
  email: text("email").notNull().unique(),
  name: text("name").default("").notNull(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  ...timestamps,
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
