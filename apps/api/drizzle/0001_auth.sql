CREATE TABLE "auth_strategies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"display_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_encrypted" text,
	"allow_self_registration" boolean DEFAULT false NOT NULL,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_role_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"strategy_kind" text NOT NULL,
	"provider_subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_passwords" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"strategy_kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_strategies" ADD CONSTRAINT "auth_strategies_default_role_id_roles_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_identities" ADD CONSTRAINT "member_identities_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_passwords" ADD CONSTRAINT "member_passwords_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_strategies_kind_uq" ON "auth_strategies" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "member_identities_subject_uq" ON "member_identities" USING btree ("strategy_kind","provider_subject");--> statement-breakpoint
CREATE INDEX "otp_challenges_email_idx" ON "otp_challenges" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_member_idx" ON "sessions" USING btree ("member_id");