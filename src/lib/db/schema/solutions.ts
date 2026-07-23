import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { organizations } from "./orgs";

// A Solution is the spine of the app: one brief is diagnosed into the real
// problem, solved into a single structured answer, verified against that
// problem, and then rendered into every format (report, deck, model,
// one-pager). Because all formats come from this one model, they are guaranteed
// to tell the same story. State lives in the DB so the run is resumable.
export const solutionStatus = pgEnum("solution_status", [
  "diagnosing",
  "researching",
  "solving",
  "verifying",
  "revising",
  "completed",
  "failed",
]);

export const solutions = pgTable("solutions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  status: solutionStatus("status").notNull().default("diagnosing"),
  // The diagnosed problem: the real core problem, why it matters, the decision
  // to make, and what "solved" looks like.
  problem: jsonb("problem"),
  // The single structured answer everything renders from.
  model: jsonb("model"),
  // Gathered, citable evidence (from project knowledge/sources + optional web).
  evidence: jsonb("evidence"),
  // Whether this run gathers and cites evidence before solving.
  researchMode: boolean("research_mode").notNull().default(true),
  // The self-check: does this actually solve the diagnosed problem?
  verification: jsonb("verification"),
  iteration: integer("iteration").notNull().default(0),
  error: text("error"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Solution = typeof solutions.$inferSelect;
