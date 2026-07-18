import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "./auth";
import { agentTasks } from "./agents";

// Chronological record of a delegated task's life after creation: results
// produced by agents and follow-up feedback from humans. Feedback re-opens
// the task; the coordinator continues with the full history as context.
export const agentTaskUpdates = pgTable(
  "agent_task_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => agentTasks.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // result | feedback
    content: text("content").notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_task_updates_task_idx").on(t.taskId)]
);

export type AgentTaskUpdate = typeof agentTaskUpdates.$inferSelect;
