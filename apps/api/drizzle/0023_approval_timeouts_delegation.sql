CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"member_id" uuid NOT NULL,
	"delegate_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD COLUMN "on_behalf_of_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "timeout" jsonb;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "fallback_selector" jsonb;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_id_members_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_member_idx" ON "approval_delegations" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations" USING btree ("delegate_id");--> statement-breakpoint
ALTER TABLE "approval_decisions" ADD CONSTRAINT "approval_decisions_on_behalf_of_id_members_id_fk" FOREIGN KEY ("on_behalf_of_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;