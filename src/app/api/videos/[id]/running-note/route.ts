import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { runningNotes } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";
import { parseJson, runningNoteInput } from "@/lib/validation";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]/running-note">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const [runningNote] = await db.select().from(runningNotes).where(eq(runningNotes.videoId, id)).limit(1);
    return NextResponse.json({ runningNote: runningNote ?? null });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext<"/api/videos/[id]/running-note">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const input = parseJson(runningNoteInput, await request.json());
    const now = new Date();
    const [runningNote] = await db
      .insert(runningNotes)
      .values({ videoId: id, body: input.body, updatedAt: now })
      .onConflictDoUpdate({
        target: runningNotes.videoId,
        set: { body: input.body, updatedAt: now },
      })
      .returning();
    return NextResponse.json({ runningNote });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/videos/[id]/running-note">,
) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await db.delete(runningNotes).where(eq(runningNotes.videoId, id));
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
