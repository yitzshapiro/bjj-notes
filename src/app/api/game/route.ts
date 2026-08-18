import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { driveItems, gameEntries, gameHits, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { GoogleDriveError } from "@/lib/drive";
import { gameEntryCreateInput, parseJson } from "@/lib/validation";

/** Everything in your game, newest hit first, with the full hit history. */
export async function GET() {
  try {
    await requireAuth();

    const rows = await db
      .select({
        entry: gameEntries,
        video: { id: driveItems.id, name: driveItems.name, path: driveItems.path },
        section: {
          practiceCount: videoSections.practiceCount,
          focused: videoSections.focused,
          starred: videoSections.starred,
        },
      })
      .from(gameEntries)
      .innerJoin(driveItems, eq(gameEntries.videoId, driveItems.id))
      .leftJoin(videoSections, eq(gameEntries.sectionId, videoSections.id))
      .where(isNull(driveItems.deletedAt))
      .orderBy(asc(gameEntries.sortOrder), desc(gameEntries.addedAt));

    const hits = await db
      .select()
      .from(gameHits)
      .orderBy(desc(gameHits.hitAt));

    const byEntry = new Map<string, typeof hits>();
    for (const hit of hits) {
      const list = byEntry.get(hit.entryId) ?? [];
      list.push(hit);
      byEntry.set(hit.entryId, list);
    }

    return NextResponse.json({
      entries: rows.map((row) => ({
        ...row.entry,
        video: row.video,
        practiceCount: row.section?.practiceCount ?? 0,
        focused: row.section?.focused ?? false,
        starred: row.section?.starred ?? false,
        hits: byEntry.get(row.entry.id) ?? [],
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}

/** Add a division to your game. Adding one already there is not an error. */
export async function POST(request: NextRequest) {
  try {
    await requireAuth();
    const input = parseJson(gameEntryCreateInput, await request.json());

    const [section] = await db
      .select()
      .from(videoSections)
      .where(eq(videoSections.id, input.sectionId))
      .limit(1);
    if (!section) throw new GoogleDriveError("Division not found", 404);

    const [existing] = await db
      .select()
      .from(gameEntries)
      .where(eq(gameEntries.sectionId, section.id))
      .limit(1);
    if (existing) {
      return NextResponse.json({ entry: { ...existing, hits: [] }, created: false });
    }

    const [entry] = await db
      .insert(gameEntries)
      .values({
        sectionId: section.id,
        videoId: section.videoId,
        label: section.label,
        startSeconds: section.startSeconds,
        note: input.note ?? null,
      })
      .returning();

    return NextResponse.json({ entry: { ...entry, hits: [] }, created: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** Remove by section id, so callers holding a division don't need the entry id. */
export async function DELETE(request: NextRequest) {
  try {
    await requireAuth();
    const sectionId = request.nextUrl.searchParams.get("sectionId");
    if (!sectionId) throw new GoogleDriveError("sectionId is required", 400);

    const [removed] = await db
      .delete(gameEntries)
      .where(and(eq(gameEntries.sectionId, sectionId)))
      .returning({ id: gameEntries.id });
    if (!removed) throw new GoogleDriveError("That division is not in your game", 404);

    return NextResponse.json({ deleted: true, id: removed.id });
  } catch (error) {
    return apiError(error);
  }
}
