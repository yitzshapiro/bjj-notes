import { asc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { driveItems, videoProgress } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";

type LibraryNode = typeof driveItems.$inferSelect & {
  kind: "folder" | "video";
  durationSeconds?: number;
  progressSeconds?: number;
  progress: number;
  completed: boolean;
  starred: boolean;
  children: LibraryNode[];
};

export async function GET() {
  try {
    await requireAuth();
    const rows = await db
      .select({ item: driveItems, progress: videoProgress })
      .from(driveItems)
      .leftJoin(videoProgress, eq(driveItems.id, videoProgress.videoId))
      .where(isNull(driveItems.deletedAt))
      .orderBy(asc(driveItems.depth), asc(driveItems.sortOrder), asc(driveItems.name));

    const byId = new Map<string, LibraryNode>();
    for (const row of rows) {
      const durationSeconds = row.progress?.durationSeconds ??
        (row.item.durationMs == null ? undefined : row.item.durationMs / 1000);
      const progressSeconds = row.progress?.positionSeconds;
      byId.set(row.item.id, {
        ...row.item,
        kind: row.item.itemType,
        durationSeconds,
        progressSeconds,
        progress: durationSeconds && progressSeconds ? Math.min(1, progressSeconds / durationSeconds) : 0,
        completed: row.progress?.completed ?? false,
        starred: row.progress?.starred ?? false,
        updatedAt: row.progress?.updatedAt ?? row.item.updatedAt,
        children: [],
      });
    }

    const items: LibraryNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentId ? byId.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else items.push(node);
    }

    const lastSyncedAt = rows.reduce<Date | null>(
      (latest, row) => (!latest || row.item.syncedAt > latest ? row.item.syncedAt : latest),
      null,
    );

    return NextResponse.json({
      root: items.length === 1 ? items[0] : undefined,
      items,
      syncedAt: lastSyncedAt,
      lastSyncedAt,
    });
  } catch (error) {
    return apiError(error);
  }
}
