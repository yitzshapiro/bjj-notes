import { asc, eq, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { driveItems, sectionTags, tags, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";

/** The tag vocabulary with how many live divisions currently carry each one. */
export async function GET() {
  try {
    await requireAuth();

    const rows = await db
      .select({
        id: tags.id,
        slug: tags.slug,
        kind: tags.kind,
        label: tags.label,
        sortOrder: tags.sortOrder,
        count: sql<number>`count(${sectionTags.sectionId})`.mapWith(Number),
      })
      .from(tags)
      .leftJoin(sectionTags, eq(sectionTags.tagId, tags.id))
      .leftJoin(videoSections, eq(sectionTags.sectionId, videoSections.id))
      .leftJoin(driveItems, eq(videoSections.videoId, driveItems.id))
      .where(isNull(driveItems.deletedAt))
      .groupBy(tags.id)
      .orderBy(asc(tags.kind), asc(tags.sortOrder));

    return NextResponse.json({ tags: rows });
  } catch (error) {
    return apiError(error);
  }
}
