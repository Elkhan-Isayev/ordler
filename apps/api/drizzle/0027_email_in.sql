CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" text NOT NULL,
	"from_address" text NOT NULL,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"request_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" text NOT NULL,
	"port" integer NOT NULL,
	"security" text NOT NULL,
	"verify_tls" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"password_encrypted" text,
	"folder" text DEFAULT 'INBOX' NOT NULL,
	"last_poll_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "request_types" ADD COLUMN "email_address" text;--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inbound_emails_message_id_uq" ON "inbound_emails" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "inbound_emails_received_idx" ON "inbound_emails" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "request_types_email_address_uq" ON "request_types" USING btree ("email_address");