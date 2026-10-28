ALTER TABLE "approval_steps" ADD COLUMN "condition" jsonb;--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "routing_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;