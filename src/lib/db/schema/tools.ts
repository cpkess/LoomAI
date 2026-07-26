import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./orgs";

// Tool registry (schema stub — execution engine is a follow-up).
// Tools are declared platform- or org-wide and enabled per workspace.
export const tools = pgTable("tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  kind: text("kind").notNull(), // e.g. web_search, calculator, rest_api, sql
  config: jsonb("config").notNull().default({}),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceTools = pgTable(
  "workspace_tools",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    toolId: uuid("tool_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("workspace_tools_idx").on(t.workspaceId, t.toolId)]
);
