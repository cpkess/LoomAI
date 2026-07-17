ALTER TABLE "agent_tasks" ADD COLUMN "result" text;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;