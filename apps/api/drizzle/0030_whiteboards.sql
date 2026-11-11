CREATE TABLE "issue_whiteboards" (
	"issue_id" uuid NOT NULL,
	"whiteboard_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_whiteboards_issue_id_whiteboard_id_pk" PRIMARY KEY("issue_id","whiteboard_id")
);
--> statement-breakpoint
CREATE TABLE "whiteboard_elements" (
	"whiteboard_id" uuid NOT NULL,
	"element_id" text NOT NULL,
	"version" integer NOT NULL,
	"version_nonce" integer NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint NOT NULL,
	"data" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_elements_whiteboard_id_element_id_pk" PRIMARY KEY("whiteboard_id","element_id")
);
--> statement-breakpoint
CREATE TABLE "whiteboard_files" (
	"whiteboard_id" uuid NOT NULL,
	"file_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "whiteboard_files_whiteboard_id_file_id_pk" PRIMARY KEY("whiteboard_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "whiteboards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"team_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_by" uuid,
	"seq" bigint DEFAULT 0 NOT NULL,
	"element_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issue_whiteboards" ADD CONSTRAINT "issue_whiteboards_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_whiteboards" ADD CONSTRAINT "issue_whiteboards_whiteboard_id_whiteboards_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "whiteboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_whiteboards" ADD CONSTRAINT "issue_whiteboards_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_elements" ADD CONSTRAINT "whiteboard_elements_whiteboard_id_whiteboards_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "whiteboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_elements" ADD CONSTRAINT "whiteboard_elements_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_files" ADD CONSTRAINT "whiteboard_files_whiteboard_id_whiteboards_id_fk" FOREIGN KEY ("whiteboard_id") REFERENCES "whiteboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboard_files" ADD CONSTRAINT "whiteboard_files_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_whiteboards_board_idx" ON "issue_whiteboards" USING btree ("whiteboard_id");--> statement-breakpoint
CREATE INDEX "whiteboard_elements_seq_idx" ON "whiteboard_elements" USING btree ("whiteboard_id","seq");--> statement-breakpoint
CREATE INDEX "whiteboards_team_idx" ON "whiteboards" USING btree ("team_id");