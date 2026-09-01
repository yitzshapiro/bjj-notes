import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const driveItems = pgTable(
  "drive_items",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    mimeType: text("mime_type").notNull(),
    itemType: text("item_type", { enum: ["folder", "video"] }).notNull(),
    parentId: text("parent_id"),
    driveParentId: text("drive_parent_id"),
    path: jsonb("path").$type<string[]>().notNull(),
    depth: integer("depth").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    durationMs: bigint("duration_ms", { mode: "number" }),
    width: integer("width"),
    height: integer("height"),
    driveModifiedAt: timestamp("drive_modified_at", { withTimezone: true }),
    webViewLink: text("web_view_link"),
    thumbnailLink: text("thumbnail_link"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("drive_items_parent_idx").on(table.parentId),
    index("drive_items_active_type_idx").on(table.deletedAt, table.itemType),
  ],
);

export const videoProgress = pgTable("video_progress", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => driveItems.id, { onDelete: "cascade" }),
  positionSeconds: real("position_seconds").notNull().default(0),
  durationSeconds: real("duration_seconds"),
  completed: boolean("completed").notNull().default(false),
  starred: boolean("starred").notNull().default(false),
  lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const timestampedNotes = pgTable(
  "timestamped_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: text("video_id")
      .notNull()
      .references(() => driveItems.id, { onDelete: "cascade" }),
    timestampSeconds: real("timestamp_seconds").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("timestamped_notes_video_time_idx").on(table.videoId, table.timestampSeconds)],
);

export const runningNotes = pgTable("running_notes", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => driveItems.id, { onDelete: "cascade" }),
  body: text("body").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const divisionPresets = pgTable(
  "division_presets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("division_presets_label_unique").on(table.label)],
);

export const videoSections = pgTable(
  "video_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    videoId: text("video_id")
      .notNull()
      .references(() => driveItems.id, { onDelete: "cascade" }),
    presetId: uuid("preset_id").references(() => divisionPresets.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    color: text("color"),
    startSeconds: real("start_seconds").notNull(),
    endSeconds: real("end_seconds"),
    sortOrder: integer("sort_order").notNull().default(0),
    starred: boolean("starred").notNull().default(false),
    focused: boolean("focused").notNull().default(false),
    focusAddedAt: timestamp("focus_added_at", { withTimezone: true }),
    practiceCount: integer("practice_count").notNull().default(0),
    lastPracticedAt: timestamp("last_practiced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("video_sections_video_start_idx").on(table.videoId, table.startSeconds),
    index("video_sections_focus_idx").on(table.videoId, table.focused),
    index("video_sections_focused_idx").on(table.focused, table.focusAddedAt),
    index("video_sections_practiced_idx").on(table.lastPracticedAt),
    index("video_sections_starred_idx").on(table.starred),
  ],
);

/**
 * The vocabulary a division can be filed under: a position, a phase of the
 * exchange, or a named technique. Seeded from `src/lib/classify.ts`.
 */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["position", "phase", "technique"] }).notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("tags_slug_unique").on(table.slug), index("tags_kind_idx").on(table.kind)],
);

/**
 * Which tags apply to which division. `source` separates the classifier's work
 * from anything corrected by hand, so a re-run can replace its own rows without
 * discarding manual edits; `confidence` marks the auto rows worth reviewing.
 */
export const sectionTags = pgTable(
  "section_tags",
  {
    sectionId: uuid("section_id")
      .notNull()
      .references(() => videoSections.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["auto", "manual"] }).notNull().default("auto"),
    confidence: real("confidence").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.sectionId, table.tagId] }),
    index("section_tags_tag_idx").on(table.tagId),
    index("section_tags_source_idx").on(table.source),
  ],
);

/**
 * The techniques you have claimed as your own. Distinct from a game plan, which
 * is what you intend to learn, and from `practice_count`, which counts drilling
 * — an entry here is something you are actively trying to land.
 */
export const gameEntries = pgTable(
  "game_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Denormalized alongside the link for the same reason as `plan_steps`: a
    // re-import of divisions must never quietly empty your game.
    sectionId: uuid("section_id").references(() => videoSections.id, { onDelete: "set null" }),
    videoId: text("video_id")
      .notNull()
      .references(() => driveItems.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startSeconds: real("start_seconds").notNull(),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("game_entries_section_unique").on(table.sectionId),
    index("game_entries_added_idx").on(table.addedAt),
  ],
);

/**
 * One dated occasion a technique actually worked. Stored as events rather than a
 * counter so "landed it three times, on three different days, in live rolling"
 * stays answerable — a tally cannot distinguish that from three in one round.
 */
export const gameHits = pgTable(
  "game_hits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => gameEntries.id, { onDelete: "cascade" }),
    hitAt: timestamp("hit_at", { withTimezone: true }).notNull().defaultNow(),
    context: text("context", { enum: ["drilling", "positional", "live", "competition"] })
      .notNull()
      .default("live"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("game_hits_entry_idx").on(table.entryId, table.hitAt)],
);

/**
 * A named route through the library: ordered stages of divisions that build one
 * skill. Reps are not stored here — a step points at the division it drills, so
 * `video_sections.practice_count` stays the single record of what was trained.
 */
export const gamePlans = pgTable(
  "game_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    goal: text("goal"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("game_plans_slug_unique").on(table.slug)],
);

export const planStages = pgTable(
  "plan_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => gamePlans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    intent: text("intent"),
    matTest: text("mat_test"),
    timeframe: text("timeframe"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("plan_stages_plan_order_idx").on(table.planId, table.sortOrder)],
);

export const planSteps = pgTable(
  "plan_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => planStages.id, { onDelete: "cascade" }),
    // The division this step drills. Kept nullable so re-importing divisions can
    // never silently delete a plan; the denormalized fields below still resolve
    // a deep link when the link is broken.
    sectionId: uuid("section_id").references(() => videoSections.id, { onDelete: "set null" }),
    videoId: text("video_id")
      .notNull()
      .references(() => driveItems.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    startSeconds: real("start_seconds").notNull(),
    role: text("role", { enum: ["entry", "control", "attack", "recovery", "concept"] })
      .notNull()
      .default("attack"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("plan_steps_stage_order_idx").on(table.stageId, table.sortOrder),
    index("plan_steps_section_idx").on(table.sectionId),
  ],
);

/**
 * One caption track per video, uploaded as a WebVTT file.
 *
 * Drive auto-generates these for uploaded video, but exposes them only through
 * the "Manage caption tracks" UI — there is no API for them, so the `.vtt`
 * files are downloaded by hand and matched to videos on `/captions`.
 */
export const videoCaptions = pgTable("video_captions", {
  videoId: text("video_id")
    .primaryKey()
    .references(() => driveItems.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  label: text("label").notNull().default("English"),
  // The name of the uploaded file, kept so a re-upload can be recognised as the
  // same track and so an unexpected match can be traced back to its source.
  fileName: text("file_name"),
  content: text("content").notNull(),
  cueCount: integer("cue_count").notNull().default(0),
  lastCueEndSeconds: real("last_cue_end_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DriveItem = typeof driveItems.$inferSelect;
export type VideoProgress = typeof videoProgress.$inferSelect;
export type TimestampedNote = typeof timestampedNotes.$inferSelect;
export type RunningNote = typeof runningNotes.$inferSelect;
export type DivisionPreset = typeof divisionPresets.$inferSelect;
export type VideoSection = typeof videoSections.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type SectionTag = typeof sectionTags.$inferSelect;
export type GameEntry = typeof gameEntries.$inferSelect;
export type GameHit = typeof gameHits.$inferSelect;
export type GamePlan = typeof gamePlans.$inferSelect;
export type PlanStage = typeof planStages.$inferSelect;
export type PlanStep = typeof planSteps.$inferSelect;
export type VideoCaption = typeof videoCaptions.$inferSelect;
