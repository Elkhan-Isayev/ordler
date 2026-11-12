CREATE TABLE "wiki_folders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_imports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"folder_id" uuid,
	"base_url" text NOT NULL,
	"token_encrypted" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"lease_until" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "wiki_page_revisions" (
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_revisions_page_id_version_pk" PRIMARY KEY("page_id","version")
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"department_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "attachments" ALTER COLUMN "team_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "wiki_visibility" text DEFAULT 'department' NOT NULL;--> statement-breakpoint
ALTER TABLE "wiki_folders" ADD CONSTRAINT "wiki_folders_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_folders" ADD CONSTRAINT "wiki_folders_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_imports" ADD CONSTRAINT "wiki_imports_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_imports" ADD CONSTRAINT "wiki_imports_folder_id_wiki_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "wiki_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_imports" ADD CONSTRAINT "wiki_imports_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_author_id_members_id_fk" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_folder_id_wiki_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "wiki_folders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_members_id_fk" FOREIGN KEY ("updated_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_folders_department_idx" ON "wiki_folders" USING btree ("department_id","parent_id");--> statement-breakpoint
CREATE INDEX "wiki_pages_department_idx" ON "wiki_pages" USING btree ("department_id","folder_id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE no action ON UPDATE no action;