import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/db";
import { videoCaptions } from "@/db/schema";
import { apiError, requireAuth } from "@/lib/auth-guard";

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

    return new NextResponse(caption.content, {
      headers: {
        "cache-control": "private, max-age=3600, must-revalidate",
        "content-type": "text/vtt; charset=utf-8",
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
    await db.delete(videoCaptions).where(eq(videoCaptions.videoId, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
