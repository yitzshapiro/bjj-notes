import { eq, isNull, and } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, sql } from "@/db";
import { driveItems, videoCaptions } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import {
  CaptionFormatError,
  matchCaptionFile,
  type CaptionCandidate,
} from "@/lib/captions";
import { prepareCaptions } from "@/lib/caption-cues";
import { saveCaptionTrack } from "@/lib/caption-store";
import { captionUploadInput, parseJson } from "@/lib/validation";

/** Coverage summary: what has a caption track and what is still missing. */
export async function GET() {
  try {
    await requireAuth();

    const videos = await db
      .select({
        cueCount: videoCaptions.cueCount,
        id: driveItems.id,
        name: driveItems.name,
        path: driveItems.path,
        updatedAt: videoCaptions.updatedAt,
      })
      .from(driveItems)
      .leftJoin(videoCaptions, eq(videoCaptions.videoId, driveItems.id))
      .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)))
      .orderBy(driveItems.name);

    return NextResponse.json({
      total: videos.length,
      withCaptions: videos.filter((video) => video.cueCount !== null).length,
      videos: videos.map((video) => ({
        cueCount: video.cueCount,
        id: video.id,
        name: video.name,
        path: video.path,
        updatedAt: video.updatedAt,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Accepts `.srt` or `.vtt` files and stores each one against its video.
 *
 * A file whose name points at exactly one video is saved immediately. Anything
 * ambiguous or unrecognised is returned untouched, with candidates, for the
 * uploader to resolve — a caption on the wrong video is worse than a missing
 * one, so nothing is guessed.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const input = parseJson(captionUploadInput, await request.json());

    const rows = await db
      .select({
        durationMs: driveItems.durationMs,
        id: driveItems.id,
        name: driveItems.name,
        path: driveItems.path,
      })
      .from(driveItems)
      .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)));

    // Runtime separates videos that share a name, so carry it into matching.
    const videos: CaptionCandidate[] = rows.map((row) => ({
      durationSeconds: row.durationMs == null ? null : row.durationMs / 1000,
      id: row.id,
      name: row.name,
      path: row.path,
    }));

    const byId = new Map(videos.map((video) => [video.id, video]));
    const results = [];

    for (const file of input.files) {
      let parsed;
      try {
        parsed = prepareCaptions(file.content);
      } catch (error) {
        results.push({
          name: file.name,
          reason: error instanceof CaptionFormatError ? error.message : "Could not read this file",
          status: "invalid" as const,
        });
        continue;
      }

      // An explicit videoId means a human already resolved this one.
      if (file.videoId) {
        const video = byId.get(file.videoId);
        if (!video) {
          results.push({ name: file.name, reason: "That video is no longer in the library", status: "invalid" as const });
          continue;
        }
        await saveCaptionTrack(sql, { videoId: file.videoId, fileName: file.name, content: parsed.content });
        results.push({
          cueCount: parsed.cueCount,
          name: file.name,
          status: "saved" as const,
          videoId: file.videoId,
          videoName: video.name,
          videoPath: video.path,
        });
        continue;
      }

      const match = matchCaptionFile(file.name, videos, parsed.lastCueEndSeconds);
      if (match.status === "matched") {
        await saveCaptionTrack(sql, { videoId: match.videoId, fileName: file.name, content: parsed.content });
        const video = byId.get(match.videoId);
        results.push({
          confidence: match.confidence,
          cueCount: parsed.cueCount,
          name: file.name,
          status: "saved" as const,
          videoId: match.videoId,
          videoName: video?.name ?? "",
          videoPath: video?.path ?? [],
        });
        continue;
      }

      results.push({
        candidates: match.candidates,
        cueCount: parsed.cueCount,
        name: file.name,
        status: match.status,
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    return apiError(error);
  }
}
