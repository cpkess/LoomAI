-- Pivot: remove the AI-corporation abstractions (persistent AI employees, org
-- chart, delegation tasks, Board approvals/emails, project milestones). Projects
-- now spin up ephemeral subagents; nothing here is referenced by the new model.

DROP TABLE IF EXISTS agent_task_updates CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS agent_task_assignments CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS agent_tasks CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS agent_collections CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS agent_workspaces CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS agents CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS org_actions CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS board_emails CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS project_stages CASCADE;
--> statement-breakpoint
ALTER TABLE projects DROP COLUMN IF EXISTS manager_agent_id;
--> statement-breakpoint
ALTER TABLE deliverables DROP COLUMN IF EXISTS manager_agent_id;
--> statement-breakpoint
ALTER TABLE conversations DROP COLUMN IF EXISTS agent_id;
