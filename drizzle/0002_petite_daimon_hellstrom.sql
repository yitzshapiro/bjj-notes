CREATE TABLE "game_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"goal" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"name" text NOT NULL,
	"intent" text,
	"mat_test" text,
	"timeframe" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"section_id" uuid,
	"video_id" text NOT NULL,
	"label" text NOT NULL,
	"start_seconds" real NOT NULL,
	"role" text DEFAULT 'attack' NOT NULL,
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_stages" ADD CONSTRAINT "plan_stages_plan_id_game_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."game_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_stage_id_plan_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."plan_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_section_id_video_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."video_sections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_video_id_drive_items_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."drive_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_plans_slug_unique" ON "game_plans" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "plan_stages_plan_order_idx" ON "plan_stages" USING btree ("plan_id","sort_order");--> statement-breakpoint
CREATE INDEX "plan_steps_stage_order_idx" ON "plan_steps" USING btree ("stage_id","sort_order");--> statement-breakpoint
CREATE INDEX "plan_steps_section_idx" ON "plan_steps" USING btree ("section_id");