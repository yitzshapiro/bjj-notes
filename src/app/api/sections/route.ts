import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { driveItems, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { sectionScope } from "@/lib/validation";

/**
 * Divisions across the whole library rather than one video, so the focus board
 * and the starred view never depend on which folder is open.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const scope = sectionScope.parse(request.nextUrl.searchParams.get("scope") ?? "all");

    const filters = {
      focus: eq(videoSections.focused, true),
      starred: eq(videoSections.starred, true),
      practiced: gt(videoSections.practiceCount, 0),
      all: undefined,
    }[scope];

    const order = {
      focus: [asc(videoSections.focusAddedAt), asc(videoSections.startSeconds)],
      starred: [asc(driveItems.name), asc(videoSections.startSeconds)],
      practiced: [desc(videoSections.lastPracticedAt), desc(videoSections.practiceCount)],
      all: [asc(driveItems.name), asc(videoSections.startSeconds)],
    }[scope];

    const rows = await db
      .select({
        section: videoSections,
        video: {
          id: driveItems.id,
          name: driveItems.name,
          path: driveItems.path,
          durationMs: driveItems.durationMs,
        },
      })
      .from(videoSections)
      .innerJoin(driveItems, eq(videoSections.videoId, driveItems.id))
      .where(and(isNull(driveItems.deletedAt), filters))
      .orderBy(...order);

    const [totals] = await db
      .select({
        focused: sql<number>`count(*) filter (where ${videoSections.focused})`.mapWith(Number),
        practiced: sql<number>`count(*) filter (where ${videoSections.practiceCount} > 0)`.mapWith(Number),
        starred: sql<number>`count(*) filter (where ${videoSections.starred})`.mapWith(Number),
        reps: sql<number>`coalesce(sum(${videoSections.practiceCount}), 0)`.mapWith(Number),
      })
      .from(videoSections)
      .innerJoin(driveItems, eq(videoSections.videoId, driveItems.id))
      .where(isNull(driveItems.deletedAt));

    return NextResponse.json({
      sections: rows.map((row) => ({ ...row.section, video: row.video })),
      totals,
    });
  } catch (error) {
    return apiError(error);
  }
}
