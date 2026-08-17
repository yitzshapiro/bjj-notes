import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { apiError } from "@/lib/auth-guard";
import { assertActiveVideo, fetchDriveThumbnail } from "@/lib/drive";

async function thumbnailHandler(
  request: NextRequest & { auth?: { user?: { email?: string | null } } | null },
  context: RouteContext<"/api/videos/[id]/thumbnail">,
) {
  try {
    const expectedEmail = process.env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
    const actualEmail = request.auth?.user?.email?.trim().toLowerCase();
    if (!expectedEmail || actualEmail !== expectedEmail) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await context.params;
    const video = await assertActiveVideo(id);
    const upstream = await fetchDriveThumbnail(request, video);
    if (!upstream) {
      return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/jpeg",
        "cache-control": "private, max-age=86400, stale-while-revalidate=604800",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

// Thumbnail loads can span an access-token refresh; persist the rotated JWT.
export const GET = auth(thumbnailHandler);
