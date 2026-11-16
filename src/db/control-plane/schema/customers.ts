import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { organizations } from "./organizations";

export const CUSTOMER_STATUSES = ["active", "archived"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

/**
 * Customer registry. Holds only what is needed to find and own a customer;
 * all customer content lives in the database named by `databaseName`.
 *
 * Deleting an organisation is restricted while it has customers: each
 * customer database has to be dropped explicitly first.
 */
export const customers = pgTable(
  "customers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    status: text("status", { enum: CUSTOMER_STATUSES })
      .default("active")
      .notNull(),
    /** Name of this customer's dedicated PostgreSQL database. */
    databaseName: text("database_name").notNull().unique(),
    ...timestamps,
  },
  (t) => [index("customers_organization_id_idx").on(t.organizationId)],
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
