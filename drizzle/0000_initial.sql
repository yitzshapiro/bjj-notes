CREATE TABLE "drive_items" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"item_type" text NOT NULL,
	"parent_id" text,
	"drive_parent_id" text,
	"path" jsonb NOT NULL,
	"depth" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"size_bytes" bigint,
	"duration_ms" bigint,
	"width" integer,
	"height" integer,
	"drive_modified_at" timestamp with time zone,
	"web_view_link" text,
	"thumbnail_link" text,
	"synced_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_progress" (
	"video_id" text PRIMARY KEY NOT NULL,
	"position_seconds" real DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"completed" boolean DEFAULT false NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"last_watched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timestamped_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"timestamp_seconds" real NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "running_notes" (
	"video_id" text PRIMARY KEY NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "division_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "division_presets_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "video_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" text NOT NULL,
	"preset_id" uuid,
	"label" text NOT NULL,
	"color" text,
	"start_seconds" real NOT NULL,
	"end_seconds" real,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"focused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_progress" ADD CONSTRAINT "video_progress_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "timestamped_notes" ADD CONSTRAINT "timestamped_notes_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "running_notes" ADD CONSTRAINT "running_notes_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "video_sections" ADD CONSTRAINT "video_sections_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "video_sections" ADD CONSTRAINT "video_sections_preset_id_division_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."division_presets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "drive_items_parent_idx" ON "drive_items" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "drive_items_active_type_idx" ON "drive_items" USING btree ("deleted_at","item_type");
--> statement-breakpoint
CREATE INDEX "timestamped_notes_video_time_idx" ON "timestamped_notes" USING btree ("video_id","timestamp_seconds");
--> statement-breakpoint
CREATE INDEX "video_sections_video_start_idx" ON "video_sections" USING btree ("video_id","start_seconds");
--> statement-breakpoint
CREATE INDEX "video_sections_focus_idx" ON "video_sections" USING btree ("video_id","focused");
