import { timestamp } from "drizzle-orm/pg-core";

export const createdAt = timestamp("created_at", { withTimezone: true })
  .defaultNow()
  .notNull();

/** `created_at` / `updated_at` columns shared by customer tables. */
export const timestamps = {
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};
