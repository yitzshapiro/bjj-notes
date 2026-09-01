import { asc, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import {
  gameEntries,
  runningNotes,
  timestampedNotes,
  videoCaptions,
  videoProgress,
  videoSections,
} from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const video = await assertActiveVideo(id);
    const [progressRows, notes, runningRows, sections, captionRows] = await Promise.all([
      db.select().from(videoProgress).where(eq(videoProgress.videoId, id)).limit(1),
      db
        .select()
        .from(timestampedNotes)
        .where(eq(timestampedNotes.videoId, id))
        .orderBy(asc(timestampedNotes.timestampSeconds), asc(timestampedNotes.createdAt)),
      db.select().from(runningNotes).where(eq(runningNotes.videoId, id)).limit(1),
      db
        .select({ section: videoSections, gameEntryId: gameEntries.id })
        .from(videoSections)
        .leftJoin(gameEntries, eq(gameEntries.sectionId, videoSections.id))
        .where(eq(videoSections.videoId, id))
        .orderBy(asc(videoSections.sortOrder), asc(videoSections.startSeconds)),
      db
        .select({ cueCount: videoCaptions.cueCount })
        .from(videoCaptions)
        .where(eq(videoCaptions.videoId, id))
        .limit(1),
    ]);

    return NextResponse.json({
      video: {
        ...video,
        durationSeconds: video.durationMs == null ? undefined : video.durationMs / 1000,
      },
      progress: progressRows[0] ?? null,
      notes,
      runningNote: runningRows[0] ?? null,
      sections: sections.map((row) => ({ ...row.section, gameEntryId: row.gameEntryId })),
      hasCaptions: captionRows.length > 0,
    });
  } catch (error) {
    return apiError(error);
  }
}
