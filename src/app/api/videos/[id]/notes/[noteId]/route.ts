import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { timestampedNotes } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { noteUpdateInput, parseJson } from "@/lib/validation";

export async function PATCH(
  request: NextRequest,
  context: RouteContext<"/api/videos/[id]/notes/[noteId]">,
) {
  try {
    await requireAuth();
    const { id, noteId } = await context.params;
    const input = parseJson(noteUpdateInput, await request.json());
    const [note] = await db
      .update(timestampedNotes)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(timestampedNotes.id, noteId), eq(timestampedNotes.videoId, id)))
      .returning();
    if (!note) throw new GoogleDriveError("Note not found", 404);
    return NextResponse.json({ note });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext<"/api/videos/[id]/notes/[noteId]">,
) {
  try {
    await requireAuth();
    const { id, noteId } = await context.params;
    const [note] = await db
      .delete(timestampedNotes)
      .where(and(eq(timestampedNotes.id, noteId), eq(timestampedNotes.videoId, id)))
      .returning({ id: timestampedNotes.id });
    if (!note) throw new GoogleDriveError("Note not found", 404);
    return NextResponse.json({ deleted: true, id: note.id });
  } catch (error) {
    return apiError(error);
  }
}
