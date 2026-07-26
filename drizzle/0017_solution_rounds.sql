-- Solutions become rounds: a follow-up pass keeps the previous answer rather
-- than overwriting it, records the feedback that steered it, and points back at
-- the round it continues from.
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS direction text;
--> statement-breakpoint
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS parent_solution_id uuid;
--> statement-breakpoint
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS round integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS solutions_project_round_idx ON solutions (project_id, round);
