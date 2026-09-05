CREATE TABLE "video_caption_cues" (
	"video_id" text NOT NULL,
	"cue_index" integer NOT NULL,
	"start_seconds" double precision NOT NULL,
	"end_seconds" double precision NOT NULL,
	"text" text NOT NULL,
	"search_text" text NOT NULL,
	"search_end_seconds" double precision NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, search_text)) STORED NOT NULL,
	"own_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, text)) STORED NOT NULL,
	CONSTRAINT "video_caption_cues_video_id_cue_index_pk" PRIMARY KEY("video_id","cue_index")
);
--> statement-breakpoint
ALTER TABLE "video_captions" ADD COLUMN "index_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_caption_cues" ADD CONSTRAINT "video_caption_cues_video_id_video_captions_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video_captions"("video_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_caption_cues_search_idx" ON "video_caption_cues" USING gin ("search_vector");