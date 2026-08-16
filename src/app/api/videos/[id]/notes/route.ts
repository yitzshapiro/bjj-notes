import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { timestampedNotes } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";
import { noteCreateInput, parseJson } from "@/lib/validation";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]/notes">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const notes = await db
      .select()
      .from(timestampedNotes)
      .where(eq(timestampedNotes.videoId, id))
      .orderBy(asc(timestampedNotes.timestampSeconds), asc(timestampedNotes.createdAt));
    return NextResponse.json({ notes });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext<"/api/videos/[id]/notes">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const input = parseJson(noteCreateInput, await request.json());
    const [note] = await db.insert(timestampedNotes).values({ videoId: id, ...input }).returning();
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
