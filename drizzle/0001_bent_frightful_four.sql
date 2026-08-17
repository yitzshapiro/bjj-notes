ALTER TABLE "video_sections" ADD COLUMN "focus_added_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_sections" ADD COLUMN "practice_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_sections" ADD COLUMN "last_practiced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "video_sections_focused_idx" ON "video_sections" USING btree ("focused","focus_added_at");--> statement-breakpoint
CREATE INDEX "video_sections_practiced_idx" ON "video_sections" USING btree ("last_practiced_at");--> statement-breakpoint
CREATE INDEX "video_sections_starred_idx" ON "video_sections" USING btree ("starred");