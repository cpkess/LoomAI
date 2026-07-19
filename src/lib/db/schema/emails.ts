import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./orgs";
import { agents, agentTasks } from "./agents";

// Board room inbox: when a delegated task reaches a terminal state, the
// coordinating AI employee "emails" the Board its final output. These are
// internal messages (no real mail is sent), surfaced in the Board room tab.
export const boardEmails = pgTable(
  "board_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => agentTasks.id, { onDelete: "set null" }),
    fromAgentId: uuid("from_agent_id").references(() => agents.id, { onDelete: "set null" }),
    fromName: text("from_name").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    // Terminal task outcome this email reports: "completed" | "failed"
    outcome: text("outcome").notNull().default("completed"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_emails_org_idx").on(t.organizationId)]
);

export type BoardEmail = typeof boardEmails.$inferSelect;
