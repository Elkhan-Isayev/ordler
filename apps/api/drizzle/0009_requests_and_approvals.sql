CREATE TABLE "approval_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"step_id" uuid NOT NULL,
	"approver_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"comment" text,
	"snapshot_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid,
	"group_id" uuid,
	"position" integer NOT NULL,
	"origin" text NOT NULL,
	"selector" jsonb NOT NULL,
	"rule" text DEFAULT 'any' NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"resolved_approver_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"activated_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "approval_steps_owner" CHECK (("approval_steps"."request_id" is null) <> ("approval_steps"."group_id" is null))
);
--> statement-breakpoint
CREATE TABLE "counters" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"requester_id" uuid,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_groups_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "request_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_team_id" uuid NOT NULL,
	"approval_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allow_requester_approvals" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer NOT NULL,
	"group_id" uuid,
	"request_type_id" uuid NOT NULL,
	"requester_id" uuid,
	"requester_department_id" uuid,
	"target_department_id" uuid NOT NULL,
	"target_team_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"form_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"assignee_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "requests_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "source_request_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "approval_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_approver_id_members_id_fk" FOREIGN KEY ("approver_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_group_id_request_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "request_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_members_id_fk" FOREIGN KEY ("actor_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_groups" ADD CONSTRAINT "request_groups_requester_id_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_group_id_request_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "request_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_request_type_id_request_types_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "request_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_id_members_id_fk" FOREIGN KEY ("requester_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_department_id_departments_id_fk" FOREIGN KEY ("requester_department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_target_department_id_departments_id_fk" FOREIGN KEY ("target_department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_target_team_id_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_assignee_id_members_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_decisions_step_idx" ON "approval_decisions" USING btree ("step_id");--> statement-breakpoint
CREATE INDEX "approval_steps_request_idx" ON "approval_steps" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "approval_steps_group_idx" ON "approval_steps" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "request_events_request_idx" ON "request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "request_types_department_idx" ON "request_types" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "requests_requester_idx" ON "requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "requests_target_team_idx" ON "requests" USING btree ("target_team_id","status");--> statement-breakpoint
CREATE INDEX "requests_group_idx" ON "requests" USING btree ("group_id");