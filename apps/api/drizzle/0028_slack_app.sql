CREATE TABLE "slack_app" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"mode" text DEFAULT 'socket' NOT NULL,
	"secrets_encrypted" text,
	"client_id" text,
	"workspace_id" text,
	"workspace_name" text,
	"bot_user_id" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "slack_links" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"direct_messages" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_subscriptions" ALTER COLUMN "target_encrypted" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_subscriptions" ADD COLUMN "channel_id" text;--> statement-breakpoint
ALTER TABLE "chat_subscriptions" ADD COLUMN "channel_name" text;--> statement-breakpoint
ALTER TABLE "slack_app" ADD CONSTRAINT "slack_app_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_links" ADD CONSTRAINT "slack_links_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_links_user_uq" ON "slack_links" USING btree ("workspace_id","slack_user_id");