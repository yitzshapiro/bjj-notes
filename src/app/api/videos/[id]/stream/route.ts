import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { apiError } from "@/lib/auth-guard";
import { fetchDriveVideo, GoogleDriveError } from "@/lib/drive";
import { verifyPlaybackToken } from "@/lib/playback-token";

const FORWARDED_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

async function streamHandler(
  request: NextRequest & { auth?: { user?: { email?: string | null } } | null },
  context: RouteContext<"/api/videos/[id]/stream">,
) {
  try {
    const { id } = await context.params;
    const expectedEmail = process.env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
    const actualEmail = request.auth?.user?.email?.trim().toLowerCase();
    if (!expectedEmail || actualEmail !== expectedEmail) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const token = request.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Playback token required" }, { status: 401 });

    let playback: ReturnType<typeof verifyPlaybackToken>;
    try {
      playback = verifyPlaybackToken(token, id);
    } catch {
      return NextResponse.json({ error: "Playback link is invalid or expired" }, { status: 401 });
    }

    const upstream = await fetchDriveVideo(
      request,
      playback.videoId,
      request.headers.get("range"),
      playback.sizeBytes,
    );

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
    headers.set("cache-control", "private, max-age=21600, must-revalidate, no-transform");
    headers.set("vary", "Range");

    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    return apiError(error);
  }
}

// Video range requests can span an access-token refresh; persist the rotated JWT.
export const GET = auth(streamHandler);
