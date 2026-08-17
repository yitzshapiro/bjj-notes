import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPlaybackToken, verifyPlaybackToken } from "./playback-token";
import { normalizeVideoRange } from "./video-range";

describe("playback grants", () => {
  const originalSecret = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-playback-secret";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = originalSecret;
  });

  it("binds a signed grant to one active video", () => {
    const token = createPlaybackToken({ videoId: "video-1", sizeBytes: 40_000_000, version: "123" });

    expect(verifyPlaybackToken(token, "video-1")).toMatchObject({
      videoId: "video-1",
      sizeBytes: 40_000_000,
      version: "123",
    });
    expect(() => verifyPlaybackToken(token, "video-2")).toThrow();
    expect(() => verifyPlaybackToken(`${token}x`, "video-1")).toThrow();
  });
});

describe("video byte ranges", () => {
  it("bounds open-ended seeks to a 16 MiB chunk", () => {
    expect(normalizeVideoRange("bytes=100-", 40_000_000)).toBe("bytes=100-16777315");
  });

  it("caps the last chunk at the file size and preserves explicit ranges", () => {
    expect(normalizeVideoRange("bytes=39000000-", 40_000_000)).toBe("bytes=39000000-39999999");
    expect(normalizeVideoRange("bytes=100-200", 40_000_000)).toBe("bytes=100-200");
  });
});
