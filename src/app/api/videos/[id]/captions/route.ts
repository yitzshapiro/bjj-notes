import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db, sql } from "@/db";
import { videoCaptions } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { prepareCaptions } from "@/lib/caption-cues";
import { deleteCaptionTrack } from "@/lib/caption-store";

/** Serves a stored caption track for the player's <track> element. */
export async function GET(_request: NextRequest, context: RouteContext<"/api/videos/[id]/captions">) {
  try {
    await requireAuth();
    const { id } = await context.params;

    const [caption] = await db
      .select()
      .from(videoCaptions)
      .where(eq(videoCaptions.videoId, id))
      .limit(1);

    if (!caption) return new NextResponse("Not found", { status: 404 });

    // Older Drive exports contain overlapping cues and layout settings. Apply
    // the same canonical track preparation used by uploads before rendering.
    return new NextResponse(prepareCaptions(caption.content).content, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/vtt; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext<"/api/videos/[id]/captions">) {
  try {
    await requireAuth();
    const { id } = await context.params;
    await deleteCaptionTrack(sql, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
