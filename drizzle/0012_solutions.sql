-- The Solution spine: one brief → diagnosed problem → one structured answer →
-- verified → rendered into every format. One source of truth per project.

CREATE TYPE solution_status AS ENUM ('diagnosing', 'solving', 'verifying', 'revising', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS solutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status solution_status NOT NULL DEFAULT 'diagnosing',
  problem jsonb,
  model jsonb,
  verification jsonb,
  iteration integer NOT NULL DEFAULT 0,
  error text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS solutions_project_idx ON solutions (project_id);
