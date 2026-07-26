ALTER TYPE "public"."project_status" ADD VALUE 'awaiting_review' BEFORE 'completed';--> statement-breakpoint
CREATE TYPE "public"."project_stage_gate" AS ENUM('auto', 'review');--> statement-breakpoint
CREATE TYPE "public"."project_stage_status" AS ENUM('pending', 'in_progress', 'awaiting_review', 'completed', 'skipped');--> statement-breakpoint
CREATE TABLE "project_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"gate" "project_stage_gate" DEFAULT 'auto' NOT NULL,
	"status" "project_stage_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"review_feedback" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_stages_project_idx" ON "project_stages" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD COLUMN "stage_id" uuid;
