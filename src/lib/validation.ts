import { z } from "zod";

const seconds = z.number().finite().min(0);
const optionalColor = z.string().trim().min(1).max(64).nullable().optional();

export const progressInput = z
  .object({
    positionSeconds: seconds.optional(),
    durationSeconds: seconds.nullable().optional(),
    completed: z.boolean().optional(),
    starred: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const noteCreateInput = z
  .object({
    timestampSeconds: seconds,
    body: z.string().trim().min(1).max(20_000),
  })
  .strict();

export const noteUpdateInput = noteCreateInput.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export const runningNoteInput = z.object({ body: z.string().max(100_000) }).strict();

export const presetCreateInput = z
  .object({
    label: z.string().trim().min(1).max(120),
    color: optionalColor,
    sortOrder: z.number().int().min(0).optional(),
  })
  .strict();

export const presetUpdateInput = presetCreateInput.partial().refine((value) => Object.keys(value).length > 0, {
  message: "At least one field is required",
});

export const sectionCreateInput = z
  .object({
    presetId: z.uuid().nullable().optional(),
    label: z.string().trim().min(1).max(120).optional(),
    color: optionalColor,
    startSeconds: seconds,
    endSeconds: seconds.nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    starred: z.boolean().optional(),
    focused: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.presetId || value.label, { message: "presetId or label is required" })
  .refine(
    (value) => value.endSeconds == null || value.endSeconds > value.startSeconds,
    { message: "endSeconds must be greater than startSeconds", path: ["endSeconds"] },
  );

export const sectionUpdateInput = z
  .object({
    presetId: z.uuid().nullable().optional(),
    label: z.string().trim().min(1).max(120).optional(),
    color: optionalColor,
    startSeconds: seconds.optional(),
    endSeconds: seconds.nullable().optional(),
    sortOrder: z.number().int().min(0).optional(),
    starred: z.boolean().optional(),
    focused: z.boolean().optional(),
    /** Logs one more practice rep and drops the division out of the focus list. */
    markPracticed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });

export const sectionScope = z.enum(["all", "focus", "practiced", "starred"]).catch("all");

/** Query parameters for the watch history listing. */
export const historyQuery = z
  .object({
    scope: z.enum(["all", "in-progress", "completed", "starred"]).catch("all").optional(),
    limit: z.coerce.number().int().min(1).max(500).catch(200).optional().default(200),
  })
  .strict();

export const gameEntryCreateInput = z
  .object({
    sectionId: z.uuid(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const gameHitCreateInput = z
  .object({
    context: z.enum(["drilling", "positional", "live", "competition"]).optional(),
    note: z.string().trim().max(2_000).nullable().optional(),
    /** Lets last night's session be logged the morning after. */
    hitAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

/** Query parameters for the global division browser. */
export const divisionQuery = z
  .object({
    q: z.string().trim().max(200).optional(),
    /** Comma-separated tag slugs; a division must carry all of them. */
    tags: z.string().trim().max(500).optional(),
    scope: z.enum(["all", "focus", "starred", "practiced", "untouched"]).catch("all").optional(),
    limit: z.coerce.number().int().min(1).max(200).catch(60).optional().default(60),
    offset: z.coerce.number().int().min(0).catch(0).optional().default(0),
  })
  .strict();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres raises `invalid input syntax for type uuid` when a non-UUID string is
 * compared against a uuid column, so a slug lookup must not also probe the
 * primary key. Guard the id comparison with this instead.
 */
export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

/** Moves every division in one plan stage into or out of this week's focus. */
export const stageFocusInput = z
  .object({
    stageId: z.uuid(),
    focused: z.boolean(),
  })
  .strict();

export function parseJson<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ValidationError(message);
  }
  return parsed.data;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
