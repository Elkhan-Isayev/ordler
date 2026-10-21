CREATE TABLE "personal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"last_used_ip" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "mcp_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "token_max_expiry_days" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "token_allow_no_expiry" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_events" ADD COLUMN "via_token" text;--> statement-breakpoint
ALTER TABLE "personal_tokens" ADD CONSTRAINT "personal_tokens_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_tokens" ADD CONSTRAINT "personal_tokens_revoked_by_members_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personal_tokens_hash_uq" ON "personal_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "personal_tokens_member_idx" ON "personal_tokens" USING btree ("member_id","created_at");