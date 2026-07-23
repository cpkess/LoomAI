-- Prompts surface removed: knowledge lives on individual projects now, and the
-- centralized prompt library is gone. Drop the prompt tables.
DROP TABLE IF EXISTS prompt_versions CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS prompts CASCADE;
