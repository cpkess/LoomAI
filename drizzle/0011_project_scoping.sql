-- Scoping loop: an initial prompt launches a scoping conversation that produces
-- a structured work plan (charter) before the project becomes a living project.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS charter jsonb;
--> statement-breakpoint
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'chat';
