import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { divisionPresets, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo, GoogleDriveError } from "@/lib/drive";
import { parseJson, sectionCreateInput } from "@/lib/validation";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]/sections">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const sections = await db
      .select()
      .from(videoSections)
      .where(eq(videoSections.videoId, id))
      .orderBy(asc(videoSections.sortOrder), asc(videoSections.startSeconds));
    return NextResponse.json({ sections });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/videos/[id]/sections">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const input = parseJson(sectionCreateInput, await request.json());

    let preset: typeof divisionPresets.$inferSelect | undefined;
    if (input.presetId) {
      [preset] = await db
        .select()
        .from(divisionPresets)
        .where(eq(divisionPresets.id, input.presetId))
        .limit(1);
      if (!preset) throw new GoogleDriveError("Division preset not found", 404);
    }

    const [section] = await db
      .insert(videoSections)
      .values({
        videoId: id,
        presetId: input.presetId ?? null,
        label: input.label ?? preset?.label ?? "",
        color: input.color === undefined ? (preset?.color ?? null) : input.color,
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds ?? null,
        sortOrder: input.sortOrder ?? 0,
        starred: input.starred ?? false,
        focused: input.focused ?? false,
        focusAddedAt: input.focused ? new Date() : null,
      })
      .returning();
    return NextResponse.json({ section }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
