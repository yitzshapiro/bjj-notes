import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { videoProgress } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo } from "@/lib/drive";
import { parseJson, progressInput } from "@/lib/validation";

export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]/progress">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const [progress] = await db.select().from(videoProgress).where(eq(videoProgress.videoId, id)).limit(1);
    return NextResponse.json({ progress: progress ?? null });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext<"/api/videos/[id]/progress">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await assertActiveVideo(id);
    const input = parseJson(progressInput, await request.json());
    const now = new Date();
    const [progress] = await db
      .insert(videoProgress)
      .values({ videoId: id, ...input, updatedAt: now, lastWatchedAt: now })
      .onConflictDoUpdate({
        target: videoProgress.videoId,
        set: { ...input, updatedAt: now, lastWatchedAt: now },
      })
      .returning();
    return NextResponse.json({ progress });
  } catch (error) {
    return apiError(error);
  }
}
