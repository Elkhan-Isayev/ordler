CREATE TABLE "mail_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"verify_tls" boolean DEFAULT true NOT NULL,
	"username" text,
	"password_encrypted" text,
	"from_name" text,
	"from_email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "mail_settings" ADD CONSTRAINT "mail_settings_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;