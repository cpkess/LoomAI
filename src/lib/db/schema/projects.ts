import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./orgs";

// A project is a Living Project: an evolving, structured understanding of a
// problem space. Sources feed a knowledge graph, the analysis engine keeps its
// recommended next steps fresh, and it produces multi-stage deliverables. There
// is no org chart or milestone plan — projects spin up ephemeral subagents.
export const projectStatus = pgEnum("project_status", [
  "planning",
  "in_progress",
  "awaiting_review",
  "completed",
  "cancelled",
]);

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
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary"),
    // Living-project fields: the current recommended next steps (kept fresh by
    // the analysis engine) and when the knowledge was last re-evaluated.
    nextSteps: text("next_steps"),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)]
);

export type Project = typeof projects.$inferSelect;
