-- Research mode + citations: the Solution gathers evidence (from the project's
-- knowledge/sources and, when enabled, the web) and cites it, so every claim is
-- traceable.

ALTER TYPE solution_status ADD VALUE IF NOT EXISTS 'researching' BEFORE 'solving';
--> statement-breakpoint
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS evidence jsonb;
--> statement-breakpoint
ALTER TABLE solutions ADD COLUMN IF NOT EXISTS research_mode boolean NOT NULL DEFAULT true;
