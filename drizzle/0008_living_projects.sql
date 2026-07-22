CREATE TYPE "public"."project_source_kind" AS ENUM('document', 'note', 'email', 'research', 'task_output', 'manual');--> statement-breakpoint
CREATE TYPE "public"."project_source_status" AS ENUM('pending', 'analyzed', 'error');--> statement-breakpoint
CREATE TYPE "public"."project_knowledge_item_type" AS ENUM('fact', 'claim', 'insight', 'assumption', 'decision', 'question', 'risk');--> statement-breakpoint
CREATE TYPE "public"."project_knowledge_item_status" AS ENUM('active', 'challenged', 'stale', 'resolved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."project_knowledge_relation" AS ENUM('supports', 'contradicts', 'answers', 'refines', 'supersedes', 'raises');--> statement-breakpoint
CREATE TYPE "public"."deliverable_status" AS ENUM('planning', 'producing', 'reviewing', 'revising', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."deliverable_section_status" AS ENUM('planned', 'drafting', 'drafted', 'reviewing', 'revising', 'approved', 'dropped');--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_steps" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_analyzed_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "project_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "project_source_kind" DEFAULT 'note' NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"ref" uuid,
	"status" "project_source_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"added_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"analyzed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" "project_knowledge_item_type" NOT NULL,
	"content" text NOT NULL,
	"status" "project_knowledge_item_status" DEFAULT 'active' NOT NULL,
	"confidence" double precision DEFAULT 0.6 NOT NULL,
	"embedding" vector(768),
	"embedding_model_id" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_knowledge_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"source_id" uuid,
	"snippet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_knowledge_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"from_item_id" uuid NOT NULL,
	"to_item_id" uuid NOT NULL,
	"relation" "project_knowledge_relation" NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'report' NOT NULL,
	"brief" text,
	"status" "deliverable_status" DEFAULT 'planning' NOT NULL,
	"manager_agent_id" uuid,
	"quality_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"content" text,
	"iteration" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverable_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"parent_section_id" uuid,
	"order_index" integer DEFAULT 0 NOT NULL,
	"heading" text NOT NULL,
	"brief" text,
	"role" text DEFAULT 'writer' NOT NULL,
	"status" "deliverable_section_status" DEFAULT 'planned' NOT NULL,
	"content" text,
	"evaluation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliverable_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"section_id" uuid,
	"role" text,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_items" ADD CONSTRAINT "project_knowledge_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_evidence" ADD CONSTRAINT "project_knowledge_evidence_item_id_project_knowledge_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."project_knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_edges" ADD CONSTRAINT "project_knowledge_edges_from_item_id_project_knowledge_items_id_fk" FOREIGN KEY ("from_item_id") REFERENCES "public"."project_knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_edges" ADD CONSTRAINT "project_knowledge_edges_to_item_id_project_knowledge_items_id_fk" FOREIGN KEY ("to_item_id") REFERENCES "public"."project_knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_views" ADD CONSTRAINT "project_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_manager_agent_id_agents_id_fk" FOREIGN KEY ("manager_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_sections" ADD CONSTRAINT "deliverable_sections_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliverable_events" ADD CONSTRAINT "deliverable_events_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_sources_project_idx" ON "project_sources" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_knowledge_items_project_idx" ON "project_knowledge_items" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_knowledge_items_embedding_idx" ON "project_knowledge_items" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "project_knowledge_evidence_item_idx" ON "project_knowledge_evidence" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "project_knowledge_edges_project_idx" ON "project_knowledge_edges" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_events_project_idx" ON "project_events" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_views_idx" ON "project_views" USING btree ("project_id","user_id");
