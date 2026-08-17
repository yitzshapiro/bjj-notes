import type { NextRequest } from "next/server";
import { getToken, type JWT } from "next-auth/jwt";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

import { refreshGoogleAccessToken } from "@/auth";
import { db } from "@/db";
import { driveItems } from "@/db/schema";
import { normalizeVideoRange } from "@/lib/video-range";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const THUMBNAIL_WIDTH = 640;

type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string;
  };
};

type SyncedDriveItem = typeof driveItems.$inferInsert;

export class GoogleDriveError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "GoogleDriveError";
  }
}

class DriveClient {
  constructor(private token: JWT) {}

  private async accessToken() {
    if (
      !this.token.googleAccessToken ||
      !this.token.googleAccessTokenExpiresAt ||
      Date.now() >= this.token.googleAccessTokenExpiresAt - 30_000
    ) {
      this.token = await refreshGoogleAccessToken(this.token);
    }

    if (!this.token.googleAccessToken || this.token.googleTokenError) {
      throw new GoogleDriveError("Google Drive authorization expired. Sign in again.", 401);
    }

    return this.token.googleAccessToken;
  }

  async fetch(url: string, init: RequestInit = {}) {
    let accessToken = await this.accessToken();
    let response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });

    if (response.status === 401 && this.token.googleRefreshToken) {
      this.token = await refreshGoogleAccessToken({
        ...this.token,
        googleAccessTokenExpiresAt: 0,
      });
      accessToken = await this.accessToken();
      response = await fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
    }

    return response;
  }

  async json<T>(url: string): Promise<T> {
    const response = await this.fetch(url);
    if (!response.ok) {
      const detail = await response.text();
      throw new GoogleDriveError(
        `Google Drive request failed (${response.status})${detail ? `: ${detail.slice(0, 500)}` : ""}`,
        response.status === 403 || response.status === 404 ? response.status : 502,
      );
    }
    return (await response.json()) as T;
  }
}

export async function createDriveClient(request: NextRequest) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new GoogleDriveError("AUTH_SECRET is required", 500);
  }

  const token = await getToken({
    req: request,
    secret,
    // Match the cookie Auth.js actually issued. Local `next start` can run in
    // production mode over plain HTTP, while a hosted request uses the secure prefix.
    secureCookie: request.cookies
      .getAll()
      .some((cookie) => cookie.name.startsWith("__Secure-authjs.session-token")),
  });

  if (!token) {
    throw new GoogleDriveError("Authentication required", 401);
  }

  return new DriveClient(token);
}

function fileUrl(fileId: string, fields: string) {
  const params = new URLSearchParams({ fields, supportsAllDrives: "true" });
  return `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`;
}

async function listChildren(client: DriveClient, folderId: string) {
  const files: GoogleDriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${folderId.replaceAll("'", "\\'")}' in parents and trashed = false`,
      pageSize: "1000",
      orderBy: "name_natural",
      spaces: "drive",
      fields:
        "nextPageToken,files(id,name,mimeType,parents,modifiedTime,size,webViewLink,thumbnailLink,videoMediaMetadata)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const page = await client.json<{ files?: GoogleDriveFile[]; nextPageToken?: string }>(
      `${DRIVE_API}/files?${params}`,
    );
    files.push(...(page.files ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  return files
    .filter(
      (file) =>
        file.mimeType === FOLDER_MIME_TYPE ||
        (file.mimeType.startsWith("video/") && !file.name.startsWith("._")),
    )
    .sort((left, right) => {
      const byName = left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      return byName || left.id.localeCompare(right.id);
    });
}

function toSyncedItem(
  file: GoogleDriveFile,
  parentId: string | null,
  path: string[],
  depth: number,
  sortOrder: number,
  syncedAt: Date,
): SyncedDriveItem {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    itemType: file.mimeType === FOLDER_MIME_TYPE ? "folder" : "video",
    parentId,
    driveParentId: file.parents?.[0] ?? null,
    path,
    depth,
    sortOrder,
    sizeBytes: file.size ? Number(file.size) : null,
    durationMs: file.videoMediaMetadata?.durationMillis
      ? Number(file.videoMediaMetadata.durationMillis)
      : null,
    width: file.videoMediaMetadata?.width ?? null,
    height: file.videoMediaMetadata?.height ?? null,
    driveModifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
    webViewLink: file.webViewLink ?? null,
    thumbnailLink: file.thumbnailLink ?? null,
    syncedAt,
    deletedAt: null,
    updatedAt: syncedAt,
  };
}

export async function syncDriveLibrary(request: NextRequest) {
  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID?.trim();
  if (!rootFolderId) {
    throw new GoogleDriveError("DRIVE_ROOT_FOLDER_ID is required", 500);
  }

  const client = await createDriveClient(request);
  const root = await client.json<GoogleDriveFile>(
    fileUrl(rootFolderId, "id,name,mimeType,parents,modifiedTime,webViewLink"),
  );
  if (root.mimeType !== FOLDER_MIME_TYPE) {
    throw new GoogleDriveError("DRIVE_ROOT_FOLDER_ID must identify a Google Drive folder", 400);
  }

  const syncedAt = new Date();
  const discovered: SyncedDriveItem[] = [toSyncedItem(root, null, [root.name], 0, 0, syncedAt)];
  const visitedFolders = new Set<string>();

  async function walk(folder: GoogleDriveFile, parentPath: string[], depth: number) {
    if (visitedFolders.has(folder.id)) return;
    visitedFolders.add(folder.id);

    const children = await listChildren(client, folder.id);
    for (const [sortOrder, child] of children.entries()) {
      const path = [...parentPath, child.name];
      discovered.push(toSyncedItem(child, folder.id, path, depth, sortOrder, syncedAt));
      if (child.mimeType === FOLDER_MIME_TYPE) {
        await walk(child, path, depth + 1);
      }
    }
  }

  await walk(root, [root.name], 1);

  for (let offset = 0; offset < discovered.length; offset += 250) {
    const chunk = discovered.slice(offset, offset + 250);
    await db
      .insert(driveItems)
      .values(chunk)
      .onConflictDoUpdate({
        target: driveItems.id,
        set: {
          // Column objects render as table-qualified references. PostgreSQL's
          // EXCLUDED pseudo-table only accepts `excluded.column`, so use the
          // physical column names for multi-row upserts.
          name: sql.raw(`excluded.${driveItems.name.name}`),
          mimeType: sql.raw(`excluded.${driveItems.mimeType.name}`),
          itemType: sql.raw(`excluded.${driveItems.itemType.name}`),
          parentId: sql.raw(`excluded.${driveItems.parentId.name}`),
          driveParentId: sql.raw(`excluded.${driveItems.driveParentId.name}`),
          path: sql.raw(`excluded.${driveItems.path.name}`),
          depth: sql.raw(`excluded.${driveItems.depth.name}`),
          sortOrder: sql.raw(`excluded.${driveItems.sortOrder.name}`),
          sizeBytes: sql.raw(`excluded.${driveItems.sizeBytes.name}`),
          durationMs: sql.raw(`excluded.${driveItems.durationMs.name}`),
          width: sql.raw(`excluded.${driveItems.width.name}`),
          height: sql.raw(`excluded.${driveItems.height.name}`),
          driveModifiedAt: sql.raw(`excluded.${driveItems.driveModifiedAt.name}`),
          webViewLink: sql.raw(`excluded.${driveItems.webViewLink.name}`),
          thumbnailLink: sql.raw(`excluded.${driveItems.thumbnailLink.name}`),
          syncedAt: sql.raw(`excluded.${driveItems.syncedAt.name}`),
          deletedAt: sql.raw(`excluded.${driveItems.deletedAt.name}`),
          updatedAt: sql.raw(`excluded.${driveItems.updatedAt.name}`),
        },
      });
  }

  const ids = discovered.map((item) => item.id);
  const missing = await db
    .update(driveItems)
    .set({ deletedAt: syncedAt, updatedAt: syncedAt })
    .where(and(isNull(driveItems.deletedAt), notInArray(driveItems.id, ids)))
    .returning({ id: driveItems.id });

  return {
    synced: discovered.length,
    folders: discovered.filter((item) => item.itemType === "folder").length,
    videos: discovered.filter((item) => item.itemType === "video").length,
    softDeleted: missing.length,
    lastSyncedAt: syncedAt,
  };
}

export async function fetchDriveVideo(
  request: NextRequest,
  fileId: string,
  range: string | null,
  sizeBytes: number | null,
) {
  const client = await createDriveClient(request);
  const params = new URLSearchParams({ alt: "media", supportsAllDrives: "true" });
  const boundedRange = normalizeVideoRange(range, sizeBytes);
  const headers = boundedRange ? { Range: boundedRange } : undefined;
  return client.fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params}`, {
    headers,
    signal: request.signal,
  });
}

function resizedThumbnail(link: string) {
  // Drive hands back a small `=s220` crop; the same link serves a larger frame.
  return link.replace(/=s\d+$/, `=s${THUMBNAIL_WIDTH}`);
}

/**
 * Drive derives a video's thumbnail from a frame of the file itself. The stored
 * link expires well before the next sync, so a rejected one is refreshed here.
 */
export async function fetchDriveThumbnail(
  request: NextRequest,
  video: typeof driveItems.$inferSelect,
) {
  const client = await createDriveClient(request);

  async function load(link: string) {
    const url = resizedThumbnail(link);
    const authorized = await client.fetch(url, { signal: request.signal });
    if (authorized.ok) return authorized;
    await authorized.body?.cancel();

    // The thumbnail host sits outside the Drive API and can reject a bearer
    // token outright, so fall back to an unauthenticated read of the same link.
    const anonymous = await fetch(url, { signal: request.signal, cache: "no-store" });
    if (anonymous.ok) return anonymous;
    await anonymous.body?.cancel();
    return null;
  }

  if (video.thumbnailLink) {
    const cached = await load(video.thumbnailLink);
    if (cached) return cached;
  }

  const fresh = await client.json<GoogleDriveFile>(fileUrl(video.id, "id,thumbnailLink"));
  if (!fresh.thumbnailLink || fresh.thumbnailLink === video.thumbnailLink) return null;

  await db
    .update(driveItems)
    .set({ thumbnailLink: fresh.thumbnailLink, updatedAt: new Date() })
    .where(eq(driveItems.id, video.id));

  return load(fresh.thumbnailLink);
}

export async function assertActiveVideo(videoId: string) {
  const [video] = await db
    .select()
    .from(driveItems)
    .where(and(eq(driveItems.id, videoId), eq(driveItems.itemType, "video"), isNull(driveItems.deletedAt)))
    .limit(1);

  if (!video) throw new GoogleDriveError("Video not found", 404);
  return video;
}
