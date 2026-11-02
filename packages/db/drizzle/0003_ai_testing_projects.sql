CREATE TABLE "ai_testing_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"app_url" text DEFAULT '' NOT NULL,
	"status" varchar(32) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_testing_projects_status_idx" ON "ai_testing_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai_testing_projects_created_at_idx" ON "ai_testing_projects" USING btree ("created_at");