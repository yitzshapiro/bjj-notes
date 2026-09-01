import { describe, expect, it } from "vitest";

import {
  CaptionFormatError,
  matchCaptionFile,
  normalizeCaptionName,
  parseVtt,
  type CaptionCandidate,
} from "./captions";

const video = (id: string, name: string, ...path: string[]): CaptionCandidate => ({ id, name, path });

const timed = (id: string, name: string, durationSeconds: number | null): CaptionCandidate => ({
  durationSeconds,
  id,
  name,
  path: ["Instructional"],
});

describe("normalizeCaptionName", () => {
  it("strips the -en-asr marker Drive appends after the extension", () => {
    expect(normalizeCaptionName("Volume 1 - Overview.mp4-en-asr.vtt")).toBe("volume 1 overview");
    expect(normalizeCaptionName("Volume 8 - Knee Lever.mkv-en-asr.vtt")).toBe("volume 8 knee lever");
    expect(normalizeCaptionName("Volume 4 - Applications.mp4-asr.vtt")).toBe("volume 4 applications");
  });

  it("strips caption and video extensions", () => {
    expect(normalizeCaptionName("Volume 1 - Overview.mp4.vtt")).toBe("volume 1 overview");
    expect(normalizeCaptionName("Volume 1 - Overview.vtt")).toBe("volume 1 overview");
    expect(normalizeCaptionName("Volume 1 - Overview.mp4")).toBe("volume 1 overview");
  });

  it("flattens the separators scene releases use", () => {
    expect(normalizeCaptionName("The.Sport.of.Kings.Vol.1.720p.mkv")).toBe(
      "the sport of kings vol 1 720p",
    );
  });

  it("drops the track description Drive appends", () => {
    expect(normalizeCaptionName("Volume 2 - Bottom - English (detected).vtt")).toBe("volume 2 bottom");
    expect(normalizeCaptionName("Volume 2 - Bottom (auto-generated).vtt")).toBe("volume 2 bottom");
  });

  it("ignores a leading directory", () => {
    expect(normalizeCaptionName("Half Guard/Volume 1 - Overview.vtt")).toBe("volume 1 overview");
  });
});

describe("matchCaptionFile", () => {
  const videos = [
    video("a", "Volume 1 - Overview.mp4", "Danaher", "Half Guard"),
    video("b", "Volume 2 - Bottom, Elbow Escape.mp4", "Danaher", "Half Guard"),
    video("c", "Volume 1 - Overview.mp4", "Gordon Ryan", "Passing"),
  ];

  it("matches a unique name exactly", () => {
    const result = matchCaptionFile("Volume 2 - Bottom, Elbow Escape.mp4.vtt", videos);
    expect(result).toMatchObject({ confidence: "exact", status: "matched", videoId: "b" });
  });

  it("refuses to guess when a name is shared by several videos", () => {
    const result = matchCaptionFile("Volume 1 - Overview.vtt", videos);
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(["a", "c"]);
  });

  it("falls back to containment only when it singles out one video", () => {
    const result = matchCaptionFile("Volume 2 - Bottom, Elbow Escape - extra.vtt", videos);
    expect(result).toMatchObject({ confidence: "fuzzy", status: "matched", videoId: "b" });
  });

  it("reports a name that matches nothing", () => {
    expect(matchCaptionFile("Some Other Seminar.vtt", videos).status).toBe("unmatched");
  });

  it("reports an empty name rather than matching everything", () => {
    expect(matchCaptionFile(".vtt", videos).status).toBe("unmatched");
  });
});

describe("parseVtt", () => {
  const sample = ["WEBVTT", "", "00:00:01.000 --> 00:00:04.500", "line one", "", "00:01:02.250 --> 00:01:05.750", "line two", ""].join("\n");

  it("counts cues and finds the last end time", () => {
    expect(parseVtt(sample)).toEqual({ cueCount: 2, lastCueEndSeconds: 65.75 });
  });

  it("accepts a byte-order mark and comma decimals", () => {
    const withBom = "﻿WEBVTT\n\n00:00.000 --> 00:02,500\nhello\n";
    expect(parseVtt(withBom).cueCount).toBe(1);
  });

  it("rejects a file that is not WebVTT", () => {
    expect(() => parseVtt("1\n00:00:01,000 --> 00:00:02,000\nsrt\n")).toThrow(CaptionFormatError);
  });

  it("rejects a header with no cues", () => {
    expect(() => parseVtt("WEBVTT\n\n")).toThrow(CaptionFormatError);
  });
});

describe("matchCaptionFile with duration", () => {
  // The real case: six "Volume 1 - Overview.mp4" files, runtimes far apart.
  const shared = [
    timed("half-guard", "Volume 1 - Overview.mp4", 3827),
    timed("escapes", "Volume 1 - Overview.mp4", 3969),
    timed("mount", "Volume 1 - Overview.mp4", 4630),
  ];

  it("picks the video whose runtime matches the last cue", () => {
    const result = matchCaptionFile("Volume 1 - Overview.mp4-en-asr.vtt", shared, 3828.559);
    expect(result).toMatchObject({ confidence: "duration", status: "matched", videoId: "half-guard" });
  });

  it("stays ambiguous when two runtimes are both close", () => {
    const close = [timed("a", "Volume 1.mp4", 3827), timed("b", "Volume 1.mp4", 3860)];
    expect(matchCaptionFile("Volume 1.vtt", close, 3828).status).toBe("ambiguous");
  });

  it("stays ambiguous when no runtime is near the last cue", () => {
    expect(matchCaptionFile("Volume 1 - Overview.vtt", shared, 100).status).toBe("ambiguous");
  });

  it("stays ambiguous when a candidate has no known runtime", () => {
    const partial = [timed("a", "Volume 1.mp4", 3827), timed("b", "Volume 1.mp4", null)];
    expect(matchCaptionFile("Volume 1.vtt", partial, 3828).status).toBe("ambiguous");
  });

  it("stays ambiguous when the file's own duration is unknown", () => {
    expect(matchCaptionFile("Volume 1 - Overview.vtt", shared, null).status).toBe("ambiguous");
  });
});
