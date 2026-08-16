import { and, asc, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/db";
import { driveItems, runningNotes, timestampedNotes, videoProgress, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";
import { ValidationError } from "@/lib/validation";

const formatSchema = z.enum(["json", "markdown", "timestamped-markdown", "running-text"]);

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainder = value % 60;
  return hours > 0
    ? [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

function safeFileName(name: string) {
  return name.replaceAll(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, "-").trim() || "bjj-notes";
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const videoId = request.nextUrl.searchParams.get("videoId");
    const parsedFormat = formatSchema.safeParse(request.nextUrl.searchParams.get("format") ?? "json");
    if (!parsedFormat.success) throw new ValidationError("Unsupported export format");
    const format = parsedFormat.data;

    let videos: (typeof driveItems.$inferSelect)[];
    if (videoId) {
      videos = [await assertActiveVideo(videoId)];
    } else {
      videos = await db
        .select()
        .from(driveItems)
        .where(and(eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)))
        .orderBy(asc(driveItems.path));
    }

    const exported = await Promise.all(
      videos.map(async (video) => {
        const [progressRows, notes, runningRows, sections] = await Promise.all([
          db.select().from(videoProgress).where(eq(videoProgress.videoId, video.id)).limit(1),
          db
            .select()
            .from(timestampedNotes)
            .where(eq(timestampedNotes.videoId, video.id))
            .orderBy(asc(timestampedNotes.timestampSeconds)),
          db.select().from(runningNotes).where(eq(runningNotes.videoId, video.id)).limit(1),
          db
            .select()
            .from(videoSections)
            .where(eq(videoSections.videoId, video.id))
            .orderBy(asc(videoSections.sortOrder), asc(videoSections.startSeconds)),
        ]);
        return {
          video: { id: video.id, name: video.name, path: video.path },
          progress: progressRows[0] ?? null,
          timestampedNotes: notes,
          runningNote: runningRows[0] ?? null,
          sections,
        };
      }),
    );

    const baseName = safeFileName(videoId ? videos[0]?.name ?? "bjj-notes" : "bjj-library-notes");
    if (format === "json") {
      return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), videos: exported }, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${baseName}.json"`,
        },
      });
    }

    if (format === "running-text") {
      const text = exported
        .map(({ video, runningNote }) =>
          videoId ? (runningNote?.body ?? "") : `${video.path.join(" / ")}\n\n${runningNote?.body ?? ""}`,
        )
        .join("\n\n---\n\n");
      return new NextResponse(text, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": `attachment; filename="${baseName}-running-notes.txt"`,
        },
      });
    }

    const markdown = exported
      .map(({ video, progress, timestampedNotes: notes, runningNote, sections }) => {
        const parts = [`# ${video.name}`, `_${video.path.join(" / ")}_`];
        if (format === "markdown") {
          parts.push(
            "## Progress",
            progress
              ? `${formatTime(progress.positionSeconds)}${progress.completed ? " - Completed" : ""}`
              : "Not started",
            "## Divisions",
            sections.length
              ? sections
                  .map(
                    (section) =>
                      `- ${section.starred ? "★ " : ""}${section.focused ? "**Focus:** " : ""}${section.label} (${formatTime(section.startSeconds)}${section.endSeconds == null ? "" : `-${formatTime(section.endSeconds)}`})`,
                  )
                  .join("\n")
              : "No divisions.",
          );
        }
        parts.push(
          "## Timestamped notes",
          notes.length
            ? notes.map((note) => `- **${formatTime(note.timestampSeconds)}** ${note.body}`).join("\n")
            : "No timestamped notes.",
        );
        if (format === "markdown") {
          parts.push("## Running note", runningNote?.body || "No running note.");
        }
        return parts.join("\n\n");
      })
      .join("\n\n---\n\n");

    const suffix = format === "timestamped-markdown" ? "-timestamped-notes" : "";
    return new NextResponse(markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${baseName}${suffix}.md"`,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
