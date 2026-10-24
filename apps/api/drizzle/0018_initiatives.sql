CREATE TABLE "initiative_projects" (
	"initiative_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "initiative_projects_initiative_id_project_id_pk" PRIMARY KEY("initiative_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"owner_id" uuid,
	"target_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "initiative_projects" ADD CONSTRAINT "initiative_projects_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiative_projects" ADD CONSTRAINT "initiative_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_owner_id_members_id_fk" FOREIGN KEY ("owner_id") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiative_projects_project_idx" ON "initiative_projects" USING btree ("project_id");