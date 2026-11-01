CREATE TABLE "email_templates" (
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "email_templates_key_locale_pk" PRIMARY KEY("key","locale")
);
--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;