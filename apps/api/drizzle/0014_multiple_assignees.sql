CREATE TABLE "issue_assignees" (
	"issue_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "issue_assignees_issue_id_member_id_pk" PRIMARY KEY("issue_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "multiple_assignees" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "issue_assignees" ADD CONSTRAINT "issue_assignees_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignees" ADD CONSTRAINT "issue_assignees_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_assignees_member_idx" ON "issue_assignees" USING btree ("member_id");--> statement-breakpoint
-- Existing single assignees become the first entry of the new list.
INSERT INTO "issue_assignees" ("issue_id", "member_id", "position")
SELECT "id", "assignee_id", 0 FROM "issues" WHERE "assignee_id" IS NOT NULL
ON CONFLICT DO NOTHING;
