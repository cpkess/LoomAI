import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { workspaces } from "./orgs";
import { agents } from "./agents";

export const messageRole = pgEnum("message_role", ["system", "user", "assistant"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Set when this conversation is with an AI employee
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    title: text("title").notNull().default("New conversation"),
    modelId: uuid("model_id"),
    systemPromptId: uuid("system_prompt_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_workspace_user_idx").on(t.workspaceId, t.userId)]
);

export interface MessageSource {
  documentId: string;
  filename: string;
  chunkIndex: number;
  snippet: string;
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
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId)]
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
