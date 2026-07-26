-- Pivot additions: chat re-homed to projects, structured-metadata ingestion,
-- and native structured deliverables.

-- Chat is now a per-project assistant; the department workspace link is optional.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS project_id uuid;
--> statement-breakpoint
ALTER TABLE conversations ALTER COLUMN workspace_id DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS conversations_project_user_idx ON conversations (project_id, user_id);
--> statement-breakpoint
-- Preserve source structure/metadata (page/slide/sheet, original filename, kind).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
-- Structured deliverables (presentation/workbook) store their typed spec here.
ALTER TABLE deliverables ADD COLUMN IF NOT EXISTS spec jsonb;
