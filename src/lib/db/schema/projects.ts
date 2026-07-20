import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./orgs";
import { agents } from "./agents";

// A project is a larger, multi-step initiative. A project manager (an AI
// employee) plans it into ordered **milestones** (stages); each milestone is
// planned into tasks that run through the delegation engine. Milestones carry
// a **gate**: an `auto` gate advances the project as soon as its tasks finish,
// while a `review` gate pauses for the Board to approve or request changes —
// the built-in point for human feedback at each stage of a long project.
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
    managerAgentId: uuid("manager_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_org_idx").on(t.organizationId)]
);

export type Project = typeof projects.$inferSelect;

// How a milestone advances the project when its tasks finish.
export const stageGate = pgEnum("project_stage_gate", ["auto", "review"]);

export const stageStatus = pgEnum("project_stage_status", [
  "pending", // not started yet
  "in_progress", // tasks are running
  "awaiting_review", // tasks done, waiting for the Board at a review gate
  "completed",
  "skipped",
]);

export const projectStages = pgTable(
  "project_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    gate: stageGate("gate").notNull().default("auto"),
    status: stageStatus("status").notNull().default("pending"),
    // The milestone deliverable summary once its tasks finish.
    summary: text("summary"),
    // The Board's most recent review note (approval or change request).
    reviewFeedback: text("review_feedback"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_stages_project_idx").on(t.projectId)]
);

export type ProjectStage = typeof projectStages.$inferSelect;
