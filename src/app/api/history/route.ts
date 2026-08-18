import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { driveItems, videoProgress, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { HISTORY_MAX_AGE_DAYS } from "@/lib/history";
import { historyQuery, parseJson } from "@/lib/validation";

/**
 * Videos watched within the last year, most recent first.
 *
 * The cutoff filters the listing only — progress older than a year stays in the
 * database, so an old resume position is never lost by opening this page.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const params = request.nextUrl.searchParams;
    const input = parseJson(historyQuery, {
      scope: params.get("scope") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_MAX_AGE_DAYS);

    const conditions = [isNull(driveItems.deletedAt), gte(videoProgress.lastWatchedAt, cutoff)];
    if (input.scope === "completed") conditions.push(eq(videoProgress.completed, true));
    if (input.scope === "in-progress") conditions.push(eq(videoProgress.completed, false));
    if (input.scope === "starred") conditions.push(eq(videoProgress.starred, true));

    const where = and(...conditions);

    const rows = await db
      .select({
        videoId: videoProgress.videoId,
        name: driveItems.name,
        path: driveItems.path,
        durationMs: driveItems.durationMs,
        positionSeconds: videoProgress.positionSeconds,
        durationSeconds: videoProgress.durationSeconds,
        completed: videoProgress.completed,
        starred: videoProgress.starred,
        lastWatchedAt: videoProgress.lastWatchedAt,
        noteCount: sql<number>`(
          select count(*) from timestamped_notes tn where tn.video_id = ${videoProgress.videoId}
        )`.mapWith(Number),
        divisionCount: sql<number>`(
          select count(*) from ${videoSections} vs where vs.video_id = ${videoProgress.videoId}
        )`.mapWith(Number),
      })
      .from(videoProgress)
      .innerJoin(driveItems, eq(videoProgress.videoId, driveItems.id))
      .where(where)
      .orderBy(desc(videoProgress.lastWatchedAt))
      .limit(input.limit);

    const [totals] = await db
      .select({
        watched: sql<number>`count(*)`.mapWith(Number),
        completed: sql<number>`count(*) filter (where ${videoProgress.completed})`.mapWith(Number),
        seconds: sql<number>`coalesce(sum(${videoProgress.positionSeconds}), 0)`.mapWith(Number),
      })
      .from(videoProgress)
      .innerJoin(driveItems, eq(videoProgress.videoId, driveItems.id))
      .where(and(isNull(driveItems.deletedAt), gte(videoProgress.lastWatchedAt, cutoff)));

    return NextResponse.json({
      cutoff: cutoff.toISOString(),
      maxAgeDays: HISTORY_MAX_AGE_DAYS,
      totals,
      entries: rows.map((row) => {
        const duration = row.durationSeconds ?? (row.durationMs == null ? null : row.durationMs / 1000);
        return {
          ...row,
          durationSeconds: duration,
          progress: duration ? Math.min(1, row.positionSeconds / duration) : 0,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}
