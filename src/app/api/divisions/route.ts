import { and, asc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { driveItems, sectionTags, tags, videoSections } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { divisionQuery, parseJson } from "@/lib/validation";

/**
 * Search across every division in the library. Tag filters are AND-ed — asking
 * for `open-guard` and `sweep` means both, which is what makes the filter useful
 * on a library this size.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const params = request.nextUrl.searchParams;
    const input = parseJson(divisionQuery, {
      q: params.get("q") ?? undefined,
      tags: params.get("tags") ?? undefined,
      scope: params.get("scope") ?? undefined,
      limit: params.get("limit") ?? undefined,
      offset: params.get("offset") ?? undefined,
    });

    const slugs = input.tags ? input.tags.split(",").map((slug) => slug.trim()).filter(Boolean) : [];

    const conditions = [isNull(driveItems.deletedAt)];

    if (input.q) {
      const term = `%${input.q}%`;
      const match = or(ilike(videoSections.label, term), ilike(driveItems.name, term));
      if (match) conditions.push(match);
    }

    if (input.scope === "focus") conditions.push(eq(videoSections.focused, true));
    if (input.scope === "starred") conditions.push(eq(videoSections.starred, true));
    if (input.scope === "practiced") conditions.push(gt(videoSections.practiceCount, 0));
    if (input.scope === "untouched") conditions.push(eq(videoSections.practiceCount, 0));

    if (slugs.length) {
      // Every requested tag must be present, not just one of them.
      const matching = db
        .select({ sectionId: sectionTags.sectionId })
        .from(sectionTags)
        .innerJoin(tags, eq(sectionTags.tagId, tags.id))
        .where(inArray(tags.slug, slugs))
        .groupBy(sectionTags.sectionId)
        .having(sql`count(distinct ${tags.slug}) = ${slugs.length}`);
      conditions.push(inArray(videoSections.id, matching));
    }

    const where = and(...conditions);

    const [{ total }] = await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(videoSections)
      .innerJoin(driveItems, eq(videoSections.videoId, driveItems.id))
      .where(where);

    const rows = await db
      .select({
        section: videoSections,
        video: { id: driveItems.id, name: driveItems.name, path: driveItems.path },
      })
      .from(videoSections)
      .innerJoin(driveItems, eq(videoSections.videoId, driveItems.id))
      .where(where)
      .orderBy(asc(driveItems.name), asc(videoSections.startSeconds))
      .limit(input.limit)
      .offset(input.offset);

    // One extra round trip for the tags of just this page of results.
    const ids = rows.map((row) => row.section.id);
    const tagRows = ids.length
      ? await db
          .select({
            sectionId: sectionTags.sectionId,
            slug: tags.slug,
            label: tags.label,
            kind: tags.kind,
            confidence: sectionTags.confidence,
            source: sectionTags.source,
          })
          .from(sectionTags)
          .innerJoin(tags, eq(sectionTags.tagId, tags.id))
          .where(inArray(sectionTags.sectionId, ids))
          .orderBy(asc(tags.kind), asc(tags.sortOrder))
      : [];

    const bySection = new Map<string, typeof tagRows>();
    for (const row of tagRows) {
      const list = bySection.get(row.sectionId) ?? [];
      list.push(row);
      bySection.set(row.sectionId, list);
    }

    return NextResponse.json({
      total,
      limit: input.limit,
      offset: input.offset,
      divisions: rows.map((row) => ({
        ...row.section,
        video: row.video,
        tags: (bySection.get(row.section.id) ?? []).map((tag) => ({
          slug: tag.slug,
          label: tag.label,
          kind: tag.kind,
          confidence: tag.confidence,
          source: tag.source,
        })),
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
