import { doublePrecision, index, pgEnum, pgTable, text, timestamp, uuid, vector } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { organizations } from "./orgs";
import { EMBEDDING_DIMENSIONS } from "./knowledge";

// Living Projects: a project accumulates a structured, evolving understanding
// of a problem space. Inputs (`project_sources`) are analyzed into typed
// knowledge items connected by relationships (edges) and backed by evidence;
// every change is logged to a project event timeline so any conclusion is
// traceable to its evidence, reasoning, and how it evolved over time.
//
// Cross-schema references to projects/documents are plain uuids (app-layer FKs)
// to avoid schema import cycles, matching the `agent_tasks.project_id` pattern.

export const projectSourceKind = pgEnum("project_source_kind", [
  "document",
  "note",
  "email",
  "research",
  "task_output",
  "manual",
]);

export const projectSourceStatus = pgEnum("project_source_status", ["pending", "analyzed", "error"]);

export const projectSources = pgTable(
  "project_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: projectSourceKind("kind").notNull().default("note"),
    title: text("title").notNull(),
    // The raw text analyzed (kept so re-analysis and evidence snippets work).
    content: text("content").notNull().default(""),
    // Optional pointer to the originating document / board email / task.
    ref: uuid("ref"),
    status: projectSourceStatus("status").notNull().default("pending"),
    error: text("error"),
    addedByUserId: uuid("added_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
  },
  (t) => [index("project_sources_project_idx").on(t.projectId)]
);

export const knowledgeItemType = pgEnum("project_knowledge_item_type", [
  "fact",
  "claim",
  "insight",
  "assumption",
  "decision",
  "question",
  "risk",
]);

export const knowledgeItemStatus = pgEnum("project_knowledge_item_status", [
  "active",
  "challenged",
  "stale",
  "resolved",
  "superseded",
]);

export const projectKnowledgeItems = pgTable(
  "project_knowledge_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: knowledgeItemType("type").notNull(),
    content: text("content").notNull(),
    status: knowledgeItemStatus("status").notNull().default("active"),
    confidence: doublePrecision("confidence").notNull().default(0.6),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModelId: uuid("embedding_model_id"),
    // Last time this item was confirmed/refreshed — drives staleness.
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("project_knowledge_items_project_idx").on(t.projectId),
    index("project_knowledge_items_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);

export const projectKnowledgeEvidence = pgTable(
  "project_knowledge_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => projectKnowledgeItems.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id"),
    snippet: text("snippet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_knowledge_evidence_item_idx").on(t.itemId)]
);

export const knowledgeRelation = pgEnum("project_knowledge_relation", [
  "supports",
  "contradicts",
  "answers",
  "refines",
  "supersedes",
  "raises",
]);

export const projectKnowledgeEdges = pgTable(
  "project_knowledge_edges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    fromItemId: uuid("from_item_id")
      .notNull()
      .references(() => projectKnowledgeItems.id, { onDelete: "cascade" }),
    toItemId: uuid("to_item_id")
      .notNull()
      .references(() => projectKnowledgeItems.id, { onDelete: "cascade" }),
    relation: knowledgeRelation("relation").notNull(),
    rationale: text("rationale"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_knowledge_edges_project_idx").on(t.projectId)]
);

// The evolving project timeline — how understanding changed over time.
export const projectEvents = pgTable(
  "project_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_events_project_idx").on(t.projectId)]
);

// Per-user "last time you looked at this project" — powers the resume briefing.
export const projectViews = pgTable(
  "project_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_views_idx").on(t.projectId, t.userId)]
);

export type ProjectSource = typeof projectSources.$inferSelect;
export type ProjectKnowledgeItem = typeof projectKnowledgeItems.$inferSelect;
export type ProjectKnowledgeEdge = typeof projectKnowledgeEdges.$inferSelect;
export type ProjectEvent = typeof projectEvents.$inferSelect;
