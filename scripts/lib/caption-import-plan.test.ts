import { describe, expect, it } from "vitest";

import { planCaptionImport } from "./caption-import-plan";
import type { DriveVideo } from "./subtitle-drive";
import type { SubtitleState } from "./subtitle-storage";

const source: DriveVideo = {
  id: "video-a", name: "Volume 1.mp4", path: ["Course A", "Volume 1.mp4"],
  sizeBytes: 100, durationSeconds: 10, modifiedTime: "2026-09-05T00:00:00.000Z",
};
const video = {
  id: source.id, name: source.name, path: source.path, size_bytes: "100",
  duration_ms: "10000", drive_modified_at: source.modifiedTime,
};
const state: SubtitleState = {
  version: 1, usage: [], cooldownUntil: 0,
  videos: { [source.id]: { fingerprint: "source", output: "/tmp/course-a.srt", outputHash: "hash", durationSeconds: 10, complete: true } },
};

describe("caption import identity", () => {
  it("uses source IDs even when multiple courses share the same filename", () => {
    const result = planCaptionImport(state, [source], [video, { ...video, id: "video-b", path: ["Course B", source.name] }]);
    expect(result.complete.map((item) => item.video.id)).toEqual(["video-a"]);
  });

  it("refuses stale source contents or a deleted/replaced video", () => {
    expect(() => planCaptionImport(state, [source], [{ ...video, size_bytes: "101" }])).toThrow(/metadata changed/);
    expect(() => planCaptionImport(state, [source], [{ ...video, drive_modified_at: "2026-09-06T00:00:00Z" }])).toThrow(/metadata changed/);
    expect(() => planCaptionImport(state, [source], [{ ...video, id: "replacement" }])).toThrow(/matching active/);
  });

  it("reports unfinished generation without importing a partial transcript", () => {
    const result = planCaptionImport({ ...state, videos: { ...state.videos, pending: { fingerprint: "pending", output: "/tmp/pending.srt", error: "Download failed" } } }, [source], [video]);
    expect(result.complete).toHaveLength(1);
    expect(result.incomplete).toEqual([{ id: "pending", output: "/tmp/pending.srt", error: "Download failed" }]);
  });
});
