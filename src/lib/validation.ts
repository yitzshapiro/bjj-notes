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
