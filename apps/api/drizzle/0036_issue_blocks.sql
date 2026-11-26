CREATE TABLE "issue_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_blocker_id_issues_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_blocked_id_issues_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_blocks" ADD CONSTRAINT "issue_blocks_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_blocks_blocked_idx" ON "issue_blocks" USING btree ("blocked_id");