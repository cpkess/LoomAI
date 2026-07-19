import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./orgs";
import { agents } from "./agents";

// A project is a larger, multi-step request that contains tasks. A project
// manager (an AI employee) plans it into tasks and can add more; each task
// runs through the delegation engine.
export const projectStatus = pgEnum("project_status", ["planning", "in_progress", "completed", "cancelled"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: projectStatus("status").notNull().default("planning"),
    managerAgentId: uuid("manager_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)]
);

export type Project = typeof projects.$inferSelect;
