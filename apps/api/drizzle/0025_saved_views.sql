CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid NOT NULL,
	"owner_id" uuid,
	"name" text NOT NULL,
	"layout" text DEFAULT 'list' NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_views_team_idx" ON "saved_views" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "saved_views_owner_idx" ON "saved_views" USING btree ("owner_id");