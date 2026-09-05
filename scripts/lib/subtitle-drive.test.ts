import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubtitleDriveClient, type DriveVideo } from "./subtitle-drive";

const FOLDER = "application/vnd.google-apps.folder";
const video: DriveVideo = {
  id: "video-1", name: "Technique.mp4", path: ["Library", "Technique.mp4"],
  durationSeconds: 30, sizeBytes: 4, modifiedTime: "2026-09-01T00:00:00Z",
};

describe("SubtitleDriveClient", () => {
  let directory: string;
  let client: SubtitleDriveClient;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "subtitle-drive-test-"));
    vi.stubEnv("GOOGLE_ACCESS_TOKEN", "temporary-access");
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "");
    vi.stubEnv("AUTH_GOOGLE_ID", "test-client");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "test-client-secret");
    client = new SubtitleDriveClient({ authFile: join(directory, "auth.json"), signal: new AbortController().signal });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it("paginates a shared Drive tree, excludes resource forks, and guards repeated folders", async () => {
    const calls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (urlString: string) => {
      const url = new URL(urlString);
      calls.push(url);
      if (url.pathname.endsWith("/root")) return Response.json({ id: "root", name: "Library", mimeType: FOLDER, driveId: "shared" });
      expect(url.searchParams.get("supportsAllDrives")).toBe("true");
      expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
      expect(url.searchParams.get("corpora")).toBe("drive");
      expect(url.searchParams.get("driveId")).toBe("shared");
      if (url.searchParams.get("q")?.startsWith("'root'")) {
        if (url.searchParams.has("pageToken")) return Response.json({ files: [{ id: "hidden", name: "._Technique.mp4", mimeType: "video/mp4" }] });
        return Response.json({ nextPageToken: "page-2", files: [
          { id: "folder", name: "Course", mimeType: FOLDER, driveId: "shared" },
          { id: "folder", name: "Course duplicate", mimeType: FOLDER, driveId: "shared" },
        ] });
      }
      return Response.json({ files: [
        { id: "root", name: "Library cycle", mimeType: FOLDER, driveId: "shared" },
        { id: "video-1", name: "Technique.mp4", mimeType: "video/mp4", size: "4", modifiedTime: video.modifiedTime, videoMediaMetadata: { durationMillis: "30500" } },
        { id: "notes", name: "Notes.pdf", mimeType: "application/pdf" },
      ] });
    }));
    expect(await client.listVideos("root")).toEqual([{ ...video, path: ["Library", "Course", "Technique.mp4"], durationSeconds: 30.5 }]);
    expect(calls).toHaveLength(4);
  });

  it("refreshes once on 401 and prefers the environment refresh token", async () => {
    vi.stubEnv("GOOGLE_REFRESH_TOKEN", "environment-refresh");
    await writeFile(join(directory, "auth.json"), JSON.stringify({ refreshToken: "saved-refresh" }));
    let refreshes = 0;
    let metadataRequests = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/token")) {
        expect((init.body as URLSearchParams).get("refresh_token")).toBe("environment-refresh");
        refreshes += 1;
        return Response.json({ access_token: `fresh-${refreshes}`, expires_in: 3600 });
      }
      metadataRequests += 1;
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer fresh-${metadataRequests}`);
      if (metadataRequests === 1) return new Response("expired", { status: 401 });
      return Response.json({ id: video.id, name: "Renamed.mp4", mimeType: "video/mp4", size: "6", videoMediaMetadata: { durationMillis: "90000" }, modifiedTime: "2026-09-05T00:00:00Z" });
    }));
    expect(await client.metadata(video)).toEqual({ ...video, name: "Renamed.mp4", sizeBytes: 6, durationSeconds: 90, modifiedTime: "2026-09-05T00:00:00Z" });
    expect(refreshes).toBe(2);
  });

  it("reads a saved refresh token without requiring a temporary access token", async () => {
    vi.stubEnv("GOOGLE_ACCESS_TOKEN", "");
    await writeFile(join(directory, "auth.json"), JSON.stringify({ refreshToken: "saved-refresh" }));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/token")) {
        expect((init.body as URLSearchParams).get("refresh_token")).toBe("saved-refresh");
        return Response.json({ access_token: "saved-access", expires_in: 3600 });
      }
      return Response.json({ id: video.id, name: video.name, mimeType: "video/mp4" });
    }));
    expect(await client.metadata(video)).toEqual({ ...video, sizeBytes: null, durationSeconds: null, modifiedTime: null });
  });

  it("retries a 429 using Retry-After without exposing error bodies", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("sensitive-error-body", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response("sensitive-error-body", { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    await expect(client.metadata(video)).rejects.toThrow("HTTP 403");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports expired temporary access cleanly without including response secrets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("temporary-access secret", { status: 401 })));
    await expect(client.metadata(video)).rejects.toThrow("GOOGLE_ACCESS_TOKEN expired or was rejected");
  });

  it("atomically saves a complete streamed video", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data", { headers: { "Content-Length": "4" } })));
    const destination = join(directory, "video.mp4");
    await client.download(video, destination);
    expect(await readFile(destination, "utf8")).toBe("data");
    expect(await readdir(directory)).toEqual(["video.mp4"]);
  });

  it("rejects truncated video bytes, cleans temporary files, and preserves existing destinations", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { headers: { "Content-Length": "3" } })));
    const destination = join(directory, "video.mp4");
    await writeFile(destination, "original");
    await expect(client.download(video, destination)).rejects.toThrow("does not match Drive metadata");
    expect(await readFile(destination, "utf8")).toBe("original");
    expect(await readdir(directory)).toEqual(["video.mp4"]);
  });

  it("rejects file roots before traversing", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ id: video.id, name: video.name, mimeType: "video/mp4" }));
    vi.stubGlobal("fetch", fetch);
    await expect(client.listVideos(video.id)).rejects.toThrow("must identify an accessible, non-trashed Google Drive folder");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
