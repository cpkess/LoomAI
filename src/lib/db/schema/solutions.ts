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
  // What the research phase did: the questions it decomposed the problem into,
  // how much each turned up, rounds run, per-channel counts, citation coverage.
  research: jsonb("research"),
  // Whether this run gathers and cites evidence before solving.
  researchMode: boolean("research_mode").notNull().default(true),
  // A follow-up round: the feedback that steered it ("look at X instead"), the
  // round it continues from, and its position in the sequence. Rounds are kept
  // rather than overwritten, so earlier answers stay inspectable.
  direction: text("direction"),
  parentSolutionId: uuid("parent_solution_id"),
  round: integer("round").notNull().default(1),
  // The self-check: does this actually solve the diagnosed problem?
  verification: jsonb("verification"),
  iteration: integer("iteration").notNull().default(0),
  error: text("error"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Solution = typeof solutions.$inferSelect;
