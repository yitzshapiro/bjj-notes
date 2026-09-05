import { describe, expect, it } from "vitest";
import { planChunks, renderSrt } from "./subtitle-core";

describe("planChunks", () => {
  it("covers the whole video once and preserves the final fractional duration", () => {
    expect(planChunks(1200.25, 600)).toEqual([
      { index: 0, start: 0, duration: 600 },
      { index: 1, start: 600, duration: 600 },
      { index: 2, start: 1200, duration: 0.25 },
    ]);
    expect(planChunks(1200, 600)).toHaveLength(2);
    expect(planChunks(30, 600)).toEqual([{ index: 0, start: 0, duration: 30 }]);
  });

  it("rejects missing, nonfinite, zero, and negative durations", () => {
    for (const invalid of [undefined, NaN, Infinity, 0, -1]) {
      expect(() => planChunks(invalid as number, 600)).toThrow();
      expect(() => planChunks(600, invalid as number)).toThrow();
    }
  });
});

describe("renderSrt", () => {
  it("offsets chunk timestamps and clamps segments to actual chunk boundaries", () => {
    expect(renderSrt([
      { start: 600, duration: 1.5, segments: [{ start: -1, end: 5, text: "  Second\n\nchunk  " }] },
      { start: 0, duration: 600, segments: [{ start: 599, end: 601, text: "First chunk" }] },
    ])).toBe("1\n00:09:59,000 --> 00:10:00,000\nFirst chunk\n\n2\n00:10:00,000 --> 00:10:01,500\nSecond chunk\n");
  });

  it("rounds milliseconds before formatting, including minute and hour carries", () => {
    expect(renderSrt([{ start: 0, duration: 360001, segments: [
      { start: 59.9996, end: 60.9996, text: "Minute" },
      { start: 3599.9996, end: 3600.9996, text: "Hour" },
      { start: 359999.9996, end: 360001, text: "Long video" },
    ] }])).toBe("1\n00:01:00,000 --> 00:01:01,000\nMinute\n\n2\n01:00:00,000 --> 01:00:01,000\nHour\n\n3\n100:00:00,000 --> 100:00:01,000\nLong video\n");
  });

  it("trims overlaps and skips empty, zero-length, and fully overlapped cues", () => {
    expect(renderSrt([{ start: 0, duration: 10, segments: [
      { start: 0, end: 4, text: "First" },
      { start: 1, end: 3, text: "Nested" },
      { start: 3, end: 6, text: "Second" },
      { start: 6, end: 7, text: "\n\t" },
      { start: 7, end: 7, text: "Zero" },
      { start: 9, end: 12, text: "Third" },
      { start: 11, end: 12, text: "Outside" },
    ] }])).toBe("1\n00:00:00,000 --> 00:00:04,000\nFirst\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond\n\n3\n00:00:09,000 --> 00:00:10,000\nThird\n");
    expect(renderSrt([])).toBe("");
  });

  it("rejects invalid timestamps, malformed segments, and reversed intervals", () => {
    for (const bad of [NaN, Infinity, undefined]) {
      expect(() => renderSrt([{ start: 0, duration: 10, segments: [{ start: bad as number, end: 3, text: "Text" }] }])).toThrow();
    }
    expect(() => renderSrt([{ start: 0, duration: 10, segments: [{ start: 3, end: 1, text: "Text" }] }])).toThrow(/before/);
    expect(() => renderSrt([{ start: 0, duration: 10, segments: [{ start: 0, end: 1, text: undefined as unknown as string }] }])).toThrow(/text/);
    expect(() => renderSrt([{ start: 0, duration: 10, segments: undefined as never }])).toThrow(/array/);
    expect(() => renderSrt([{ start: -1, duration: 10, segments: [] }])).toThrow();
  });
});
