import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, vector } from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./orgs";
import { users } from "./auth";

export const documentStatus = pgEnum("document_status", ["pending", "processing", "ready", "error"]);

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Model used to embed this collection's chunks; all documents in a
  // collection share one embedding space.
  embeddingModelId: uuid("embedding_model_id"),
  embeddingDimensions: integer("embedding_dimensions"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionWorkspaces = pgTable(
  "collection_workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("collection_workspaces_idx").on(t.collectionId, t.workspaceId)]
);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  collectionId: uuid("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  status: documentStatus("status").notNull().default("pending"),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Fixed 768-dim column; embeddings from other models are padded/truncated to
// fit by lib/rag (dimension recorded on the collection for cosine fidelity).
export const EMBEDDING_DIMENSIONS = 768;

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("document_chunks_collection_idx").on(t.collectionId),
    index("document_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ]
);

export type Collection = typeof collections.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
