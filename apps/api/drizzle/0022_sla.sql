CREATE TABLE "business_calendars" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"holidays" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"calendar_id" uuid,
	"pause_during_approval" boolean DEFAULT true NOT NULL,
	"targets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sla_policy_id" uuid;--> statement-breakpoint
ALTER TABLE "requests" ADD COLUMN "sla_alerts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "business_calendars" ADD CONSTRAINT "business_calendars_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_calendar_id_business_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "business_calendars"("id") ON DELETE no action ON UPDATE no action;