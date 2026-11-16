import { index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./columns";
import { organizations } from "./organizations";
import { users } from "./users";

export const MEMBERSHIP_ROLES = ["owner", "member"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

/** User ↔ organisation. v1 has no permissions; the role is recorded only. */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: text("role", { enum: MEMBERSHIP_ROLES }).default("owner").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("memberships_user_org_unique").on(t.userId, t.organizationId),
    index("memberships_organization_id_idx").on(t.organizationId),
  ],
);

export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;
