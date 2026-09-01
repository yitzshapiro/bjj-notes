CREATE TABLE "video_captions" (
	"video_id" text PRIMARY KEY NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"label" text DEFAULT 'English' NOT NULL,
	"file_name" text,
	"content" text NOT NULL,
	"cue_count" integer DEFAULT 0 NOT NULL,
	"last_cue_end_seconds" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_captions" ADD CONSTRAINT "video_captions_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;