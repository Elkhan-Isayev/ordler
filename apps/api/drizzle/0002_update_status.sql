CREATE TABLE "update_status" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"latest_version" text,
	"release_name" text,
	"release_url" text,
	"release_notes" text,
	"published_at" timestamp with time zone,
	"etag" text,
	"checked_at" timestamp with time zone,
	"last_error" text
);
