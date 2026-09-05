import { describe, expect, it } from "vitest";

import { clampStudySeek, readStudySeek } from "./study-seek";

describe("study deep links", () => {
  it("distinguishes missing timestamps from an authoritative t=0", () => {
    expect(readStudySeek(null)).toBeNull();
    expect(readStudySeek("0", 150)).toBe(0);
    expect(readStudySeek(null, 150)).toBe(150);
  });

  it("uses the current URL for same-video changes and retains decimal cue starts", () => {
    expect(["12.8", "0", "187.123"].map((value) => readStudySeek(value, 150))).toEqual([12.8, 0, 187.123]);
  });

  it.each(["", "-1", "NaN", "Infinity", "1oops", "0x10", "1e3"])("ignores an invalid URL time %s", (value) => {
    expect(readStudySeek(value, 150)).toBeNull();
  });

  it("clamps to duration without silently moving valid near-end hits back a second", () => {
    expect(clampStudySeek(59.9, 60)).toBe(59.9);
    expect(clampStudySeek(70, 60)).toBe(60);
    expect(clampStudySeek(12.25, NaN)).toBe(12.25);
  });
});
