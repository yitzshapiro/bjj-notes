import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { runningNotes, timestampedNotes, videoProgress, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const video = await assertActiveVideo(id);
    const [progressRows, notes, runningRows, sections] = await Promise.all([
      db.select().from(videoProgress).where(eq(videoProgress.videoId, id)).limit(1),
      db
        .select()
        .from(timestampedNotes)
        .where(eq(timestampedNotes.videoId, id))
        .orderBy(asc(timestampedNotes.timestampSeconds), asc(timestampedNotes.createdAt)),
      db.select().from(runningNotes).where(eq(runningNotes.videoId, id)).limit(1),
      db
        .select()
        .from(videoSections)
        .where(eq(videoSections.videoId, id))
        .orderBy(asc(videoSections.sortOrder), asc(videoSections.startSeconds)),
    ]);

    return NextResponse.json({
      video: {
        ...video,
        durationSeconds: video.durationMs == null ? undefined : video.durationMs / 1000,
      },
      progress: progressRows[0] ?? null,
      notes,
      runningNote: runningRows[0] ?? null,
      sections,
    });
  } catch (error) {
    return apiError(error);
  }
}
