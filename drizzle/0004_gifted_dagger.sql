CREATE TABLE "game_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid,
	"video_id" text NOT NULL,
	"label" text NOT NULL,
	"start_seconds" real NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_hits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" text DEFAULT 'live' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_entries" ADD CONSTRAINT "game_entries_section_id_video_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."video_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_entries" ADD CONSTRAINT "game_entries_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_hits" ADD CONSTRAINT "game_hits_entry_id_game_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."game_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_entries_section_unique" ON "game_entries" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "game_entries_added_idx" ON "game_entries" USING btree ("added_at");--> statement-breakpoint
CREATE INDEX "game_hits_entry_idx" ON "game_hits" USING btree ("entry_id","hit_at");