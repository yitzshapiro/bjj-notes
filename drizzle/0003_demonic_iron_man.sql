CREATE TABLE "section_tags" (
	"section_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"source" text DEFAULT 'auto' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_tags_section_id_tag_id_pk" PRIMARY KEY("section_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "section_tags" ADD CONSTRAINT "section_tags_section_id_video_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."video_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_tags" ADD CONSTRAINT "section_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "section_tags_tag_idx" ON "section_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "section_tags_source_idx" ON "section_tags" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tags_kind_idx" ON "tags" USING btree ("kind");