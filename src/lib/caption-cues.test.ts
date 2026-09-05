import { describe, expect, it } from "vitest";

import { prepareCaptions } from "./caption-cues";

describe("prepareCaptions", () => {
  it("converts SRT millisecond timestamps and preserves all spoken text", () => {
    const prepared = prepareCaptions("\uFEFF1\r\n00:00:00,000 --> 00:00:01,250\r\nSumi gaeshi\r\nfrom here.\r\n\r\n2\r\n01:02:03,004 --> 01:02:04,999\r\nAshi garami.");
    expect(prepared.cues).toEqual([{ startSeconds: 0, endSeconds: 1.25, text: "Sumi gaeshi from here." }, { startSeconds: 3723.004, endSeconds: 3724.999, text: "Ashi garami." }]);
    expect(prepared.content).toContain("01:02:03.004 --> 01:02:04.999");
    expect(prepared.cueCount).toBe(2);
    expect(prepared.lastCueEndSeconds).toBe(3724.999);
    expect(prepareCaptions(prepared.content)).toEqual(prepared);
  });

  it("removes unsafe layout and inline markup while retaining decoded spoken words", () => {
    const prepared = prepareCaptions("WEBVTT\nKind: captions\nLanguage: en\n\nSTYLE\n::cue {color:red}\n\nNOTE source\nmetadata\n\ncue-1\n00:01.000 --> 00:03.000 line:0% position:0% align:start\n<v John><c.green>Sumi &amp; <00:01.500>ashi</c></v>\n&lt; 3 &gt; 1 &#x2014; yes.");
    expect(prepared.cues[0].text).toBe("Sumi & ashi < 3 > 1 — yes.");
    expect(prepared.content).not.toContain("line:");
    expect(prepared.content).not.toContain("<v");
    expect(prepared.content).toContain("Sumi &amp; ashi &lt; 3 &gt; 1 — yes.");
  });

  it("fixes the legacy overlapping VTT pattern without dropping distinct words", () => {
    const prepared = prepareCaptions("WEBVTT\n\n00:12.800 --> 00:18.880\nNow, whenever I go to teach upper body\ntakedowns, um there's always a\n\n00:17.119 --> 00:22.400\npredictable response. Everyone in the\nroom who's a little bit older or perhaps\n\n00:20.560 --> 00:26.720\na little less athletic looks at them\nwith horror on their face and is");
    expect(prepared.cues.map((cue) => [cue.startSeconds, cue.endSeconds])).toEqual([[12.8, 17.119], [17.119, 20.56], [20.56, 26.72]]);
    expect(prepared.cues.map((cue) => cue.text).join(" ")).toBe("Now, whenever I go to teach upper body takedowns, um there's always a predictable response. Everyone in the room who's a little bit older or perhaps a little less athletic looks at them with horror on their face and is");
  });

  it("collapses growing rolling captions across several overlapping updates", () => {
    const prepared = prepareCaptions("WEBVTT\n\n00:00.000 --> 00:04.000\nLock both hands\n\n00:01.000 --> 00:05.000\nLock both hands together\n\n00:02.000 --> 00:06.000\nLock both hands together and pull\n\n00:03.000 --> 00:07.000\nLock both hands together and pull");
    expect(prepared.cues).toEqual([
      { startSeconds: 0, endSeconds: 1, text: "Lock both hands" },
      { startSeconds: 1, endSeconds: 2, text: "together" },
      { startSeconds: 2, endSeconds: 7, text: "and pull" },
    ]);
  });

  it("collapses repeated rolling lines but preserves intentional repeated speech", () => {
    const prepared = prepareCaptions("WEBVTT\n\n00:00.000 --> 00:04.000\nFirst position\nLock both hands\n\n00:02.000 --> 00:06.000\nLock both hands\nThen pull down\n\n00:06.000 --> 00:07.000\nThen pull down\n\n00:06.500 --> 00:08.000\nPull down, pull down.");
    expect(prepared.cues.map((cue) => cue.text)).toEqual(["First position Lock both hands", "Then pull down", "Then pull down", "Pull down, pull down."]);
  });

  it("retains same-start and nested cues without simultaneous native captions", () => {
    const prepared = prepareCaptions("1\n00:00:02,000 --> 00:00:03,000\nLater words\n\n2\n00:00:00,000 --> 00:00:10,000\nFirst words\n\n3\n00:00:00,000 --> 00:00:02,000\nOther speaker");
    expect(prepared.cues).toEqual([{ startSeconds: 0, endSeconds: 2, text: "First words Other speaker" }, { startSeconds: 2, endSeconds: 10, text: "Later words" }]);
    expect(prepareCaptions(prepared.content)).toEqual(prepared);
  });

  it.each([
    "", "WEBVTT\n\n", "Not a caption", "WEBVTTbad\n\n00:00.000 --> 00:01.000\nHello",
    "1\n00:00:01,000 --> 00:00:00,000\nBackward",
    "1\n00:00:00,000 --> 00:00:00,000\nZero",
    "1\n00:99:00,000 --> 00:99:01,000\nInvalid",
    "1\n-00:00:01,000 --> 00:00:03,000\nNegative",
    "1\n00:00:00,000 --> Infinity\nInvalid",
    "1\n00:00:00,000 --> 00:00:01,000 nonsense\nInvalid",
    "WEBVTT\n\n00:00.000 --> 00:01.000\n\n",
    "WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n00:01.000 --> 00:02.000\nWorld",
  ])("rejects malformed caption input %#", (content) => {
    expect(() => prepareCaptions(content)).toThrow();
  });
});
