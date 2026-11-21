CREATE TABLE "wiki_relations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"page_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_ref" text NOT NULL,
	"type" text NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki_relations" ADD CONSTRAINT "wiki_relations_page_id_wiki_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "wiki_pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_relations" ADD CONSTRAINT "wiki_relations_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_relations_unique_idx" ON "wiki_relations" USING btree ("page_id","target_kind","target_ref","type");--> statement-breakpoint
CREATE INDEX "wiki_relations_target_idx" ON "wiki_relations" USING btree ("target_kind","target_ref");