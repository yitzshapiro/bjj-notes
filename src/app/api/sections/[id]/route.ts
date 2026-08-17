import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { divisionPresets, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { parseJson, sectionUpdateInput, ValidationError } from "@/lib/validation";

export async function PATCH(request: NextRequest, context: RouteContext<"/api/sections/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const input = parseJson(sectionUpdateInput, await request.json());
    const [current] = await db.select().from(videoSections).where(eq(videoSections.id, id)).limit(1);
    if (!current) throw new GoogleDriveError("Section not found", 404);

    let preset: typeof divisionPresets.$inferSelect | undefined;
    if (input.presetId) {
      [preset] = await db
        .select()
        .from(divisionPresets)
        .where(eq(divisionPresets.id, input.presetId))
        .limit(1);
      if (!preset) throw new GoogleDriveError("Division preset not found", 404);
    }

    const startSeconds = input.startSeconds ?? current.startSeconds;
    const endSeconds = input.endSeconds === undefined ? current.endSeconds : input.endSeconds;
    if (endSeconds != null && endSeconds <= startSeconds) {
      throw new ValidationError("endSeconds must be greater than startSeconds");
    }

    const { markPracticed, ...fields } = input;
    const now = new Date();
    const changes: Partial<typeof videoSections.$inferInsert> = {
      ...fields,
      updatedAt: now,
    };
    if (preset && input.label === undefined) changes.label = preset.label;
    if (preset && input.color === undefined) changes.color = preset.color;

    // A practiced rep always leaves the focus list; the tally is what carries forward.
    if (markPracticed) {
      changes.practiceCount = current.practiceCount + 1;
      changes.lastPracticedAt = now;
      changes.focused = false;
    }

    if (changes.focused !== undefined && changes.focused !== current.focused) {
      changes.focusAddedAt = changes.focused ? now : null;
    }

    const [section] = await db
      .update(videoSections)
      .set(changes)
      .where(eq(videoSections.id, id))
      .returning();
    return NextResponse.json({ section });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/sections/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const [section] = await db
      .delete(videoSections)
      .where(eq(videoSections.id, id))
      .returning({ id: videoSections.id });
    if (!section) throw new GoogleDriveError("Section not found", 404);
    return NextResponse.json({ deleted: true, id: section.id });
  } catch (error) {
    return apiError(error);
  }
}
