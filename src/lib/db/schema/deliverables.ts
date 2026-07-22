import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { agents } from "./agents";
import { organizations } from "./orgs";

// Multi-stage deliverables: a large output is produced by an orchestrated
// workflow — plan a living outline, have specialist workers draft each section,
// critique/edit/gap-analyze, and iterate section-by-section until configurable
// quality gates pass — rather than a single prompt. State lives in the DB so a
// run is resumable and every step is observable.

export const deliverableStatus = pgEnum("deliverable_status", [
  "planning",
  "producing",
  "reviewing",
  "revising",
  "completed",
  "failed",
  "cancelled",
]);

export const deliverables = pgTable(
  "deliverables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("report"),
    brief: text("brief"),
    status: deliverableStatus("status").notNull().default("planning"),
    managerAgentId: uuid("manager_agent_id").references(() => agents.id, { onDelete: "set null" }),
    // Quality gate thresholds (see lib/projects/quality.ts).
    qualityConfig: jsonb("quality_config").notNull().default({}),
    // The final assembled document once completed.
    content: text("content"),
    iteration: integer("iteration").notNull().default(0),
    error: text("error"),
    createdByUserId: uuid("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const sectionStatus = pgEnum("deliverable_section_status", [
  "planned",
  "drafting",
  "drafted",
  "reviewing",
  "revising",
  "approved",
  "dropped",
]);

export const deliverableSections = pgTable(
  "deliverable_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deliverableId: uuid("deliverable_id")
      .notNull()
      .references(() => deliverables.id, { onDelete: "cascade" }),
    parentSectionId: uuid("parent_section_id"),
    orderIndex: integer("order_index").notNull().default(0),
    heading: text("heading").notNull(),
    brief: text("brief"),
    // The specialist role assigned to produce this section.
    role: text("role").notNull().default("writer"),
    status: sectionStatus("status").notNull().default("planned"),
    content: text("content"),
    // Issues found by the review workers (array of {kind, detail, severity}).
    evaluation: jsonb("evaluation").notNull().default([]),
    revision: integer("revision").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

export const deliverableEvents = pgTable("deliverable_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliverableId: uuid("deliverable_id")
    .notNull()
    .references(() => deliverables.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  sectionId: uuid("section_id"),
  role: text("role"),
  summary: text("summary").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Deliverable = typeof deliverables.$inferSelect;
export type DeliverableSection = typeof deliverableSections.$inferSelect;
export type DeliverableEvent = typeof deliverableEvents.$inferSelect;
