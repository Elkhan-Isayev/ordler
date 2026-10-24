CREATE TABLE "external_refs" (
	"source_key" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"ordler_id" uuid NOT NULL,
	"source_updated_at" timestamp with time zone,
	"import_run_id" uuid,
	CONSTRAINT "external_refs_source_key_kind_external_id_pk" PRIMARY KEY("source_key","kind","external_id")
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"base_url" text,
	"email" text,
	"token_encrypted" text,
	"account" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"lease_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issues_external_key_idx" ON "issues" USING btree ("external_key");