CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"head_member_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_name" text NOT NULL,
	"base_url" text NOT NULL,
	"default_locale" text DEFAULT 'en' NOT NULL,
	"branding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"name" text NOT NULL,
	"locale" text,
	"timezone" text,
	"home_department_id" uuid,
	"manager_id" uuid,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_assignments_scope_id" CHECK (("role_assignments"."scope_type" = 'organization') = ("role_assignments"."scope_id" is null))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"system_key" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"team_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_team_id_member_id_pk" PRIMARY KEY("team_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_key_format" CHECK ("teams"."key" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_home_department_id_departments_id_fk" FOREIGN KEY ("home_department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_active_uq" ON "departments" USING btree ("name") WHERE "departments"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_email_uq" ON "members" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "role_assignments_member_idx" ON "role_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_key_uq" ON "roles" USING btree ("system_key");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_key_uq" ON "teams" USING btree ("key");--> statement-breakpoint
CREATE INDEX "teams_department_idx" ON "teams" USING btree ("department_id");