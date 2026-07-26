import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { workspaces } from "./orgs";

export const messageRole = pgEnum("message_role", ["system", "user", "assistant"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A conversation is scoped to a project (the project assistant). The legacy
    // department workspace link is kept nullable for back-compat.
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    // Project this conversation belongs to (app-layer FK to avoid a cycle).
    projectId: uuid("project_id"),
    // "chat" = the project assistant; "scoping" = the scoping-loop conversation
    // that establishes the project's work plan.
    kind: text("kind").notNull().default("chat"),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    modelId: uuid("model_id"),
    systemPromptId: uuid("system_prompt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_project_user_idx").on(t.projectId, t.userId)]
);

export interface MessageSource {
  documentId: string;
  filename: string;
  chunkIndex: number;
  snippet: string;
}

export interface MessageAction {
  type: string;
  status: "executed" | "pending_approval" | "failed";
  summary: string;
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    sources: jsonb("sources").$type<MessageSource[]>(),
    // Company actions taken (or proposed) during this assistant turn
    actions: jsonb("actions").$type<MessageAction[]>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)]
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
