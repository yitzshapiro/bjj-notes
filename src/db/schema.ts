import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("video_sections_video_start_idx").on(table.videoId, table.startSeconds),
    index("video_sections_focus_idx").on(table.videoId, table.focused),
  ],
);

export type DriveItem = typeof driveItems.$inferSelect;
export type VideoProgress = typeof videoProgress.$inferSelect;
export type TimestampedNote = typeof timestampedNotes.$inferSelect;
export type RunningNote = typeof runningNotes.$inferSelect;
export type DivisionPreset = typeof divisionPresets.$inferSelect;
export type VideoSection = typeof videoSections.$inferSelect;
