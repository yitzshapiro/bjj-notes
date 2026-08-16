import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { apiError, requireAuth } from "@/lib/auth-guard";
import { assertActiveVideo, fetchDriveVideo, GoogleDriveError } from "@/lib/drive";

const FORWARDED_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

async function streamHandler(
  request: NextRequest,
  context: RouteContext<"/api/videos/[id]/stream">,
) {
  try {
    await requireAuth();
    const { id } = await context.params;
    const video = await assertActiveVideo(id);
    const upstream = await fetchDriveVideo(request, video.id, request.headers.get("range"));

    if (!upstream.ok && upstream.status !== 416) {
      const detail = await upstream.text();
      throw new GoogleDriveError(
        `Unable to stream this video (${upstream.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        upstream.status === 403 || upstream.status === 404 ? upstream.status : 502,
      );
    }

    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");
    headers.set("cache-control", "private, no-store");

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return apiError(error);
  }
}

// Video range requests can span an access-token refresh; persist the rotated JWT.
export const GET = auth(streamHandler);
