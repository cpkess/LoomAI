import { jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations, workspaces } from "./orgs";
import { aiModels } from "./providers";
import { collections } from "./knowledge";
import { prompts } from "./prompts";

export const agentStatus = pgEnum("agent_status", ["active", "paused"]);

// AI employees: first-class organizational members with a job title and a
// place in the org chart (reports_to_* edges — exactly one may be set).
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title").notNull(),
  avatarColor: text("avatar_color"),
  status: agentStatus("status").notNull().default("active"),
  modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
  personaPromptId: uuid("persona_prompt_id").references(() => prompts.id, { onDelete: "set null" }),
  personaText: text("persona_text"),
  reportsToAgentId: uuid("reports_to_agent_id"),
  reportsToUserId: uuid("reports_to_user_id").references(() => users.id, { onDelete: "set null" }),
  config: jsonb("config").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentWorkspaces = pgTable(
  "agent_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("agent_workspaces_idx").on(t.agentId, t.workspaceId)]
);

export const agentCollections = pgTable(
  "agent_collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("agent_collections_idx").on(t.agentId, t.collectionId)]
);

// --- Delegation (schema now, engine in a follow-up) ---------------------
// A task is created by a human or agent, may be decomposed into child tasks
// (parent_task_id), and each task is assigned to agents with a coordinator
// or worker role. The future orchestration engine executes over these rows
// plus the agents' reports_to edges.

export const taskStatus = pgEnum("agent_task_status", [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
]);

export const agentTasks = pgTable("agent_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  parentTaskId: uuid("parent_task_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatus("status").notNull().default("pending"),
  result: text("result"),
  error: text("error"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentTaskAssignments = pgTable("agent_task_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => agentTasks.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("worker"), // coordinator | worker
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
