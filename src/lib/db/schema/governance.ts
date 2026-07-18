import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./orgs";
import { agents } from "./agents";

// Company actions proposed and executed by AI employees, plus the Board
// approval workflow. Every action — autonomous or approved — leaves a row
// here, so this doubles as the audit log.

export const orgActionStatus = pgEnum("org_action_status", [
  "pending_approval",
  "executed",
  "rejected",
  "failed",
]);

export const orgActions = pgTable("org_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  // Action key from lib/company/actions.ts, e.g. "hire_employee"
  type: text("type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  status: orgActionStatus("status").notNull(),
  summary: text("summary").notNull(),
  proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedByUserId: uuid("decided_by_user_id").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  result: text("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgAction = typeof orgActions.$inferSelect;
