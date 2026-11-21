CREATE TABLE "github_app" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"github_url" text DEFAULT 'https://github.com' NOT NULL,
	"organization" text,
	"app_id" text,
	"app_slug" text,
	"secrets_encrypted" text,
	"last_delivery_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "github_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_links" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"issue_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"repository" text NOT NULL,
	"ref" text NOT NULL,
	"title" text,
	"state" text,
	"url" text NOT NULL,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_pull_request_comments" (
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"comment_id" bigint,
	"identifiers" text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_pull_request_comments_repository_number_pk" PRIMARY KEY("repository","number")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "github_opened_status_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "github_merged_status_id" uuid;--> statement-breakpoint
ALTER TABLE "github_app" ADD CONSTRAINT "github_app_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_links" ADD CONSTRAINT "github_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_deliveries_received_idx" ON "github_deliveries" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "github_links_item_uq" ON "github_links" USING btree ("issue_id","kind","repository","ref");--> statement-breakpoint
CREATE INDEX "github_links_ref_idx" ON "github_links" USING btree ("repository","kind","ref");