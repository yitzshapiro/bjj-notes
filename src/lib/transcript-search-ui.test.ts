import { describe, expect, it } from "vitest";
import { highlightedTranscriptParts, transcriptSearchHref } from "./transcript-search-ui";

describe("transcript search links", () => {
  it("retains explicit zero and fractional cue starts instead of resuming saved progress", () => {
    expect(new URL(transcriptSearchHref("video", "Volume 1", 0), "https://example.com").searchParams.get("t")).toBe("0");
    expect(new URL(transcriptSearchHref("video", "Volume 1", 65.125), "https://example.com").searchParams.get("t")).toBe("65.125");
  });

  it("encodes video IDs and names as data", () => {
    const href = transcriptSearchHref("video/other", "A & B? <entry>", 5);
    expect(href.startsWith("/library/video%2Fother?")).toBe(true);
    expect(new URL(href, "https://example.com").searchParams.get("name")).toBe("A & B? <entry>");
  });
});

describe("safe transcript highlighting", () => {
  it("matches Japanese phrases across spaces or hyphens without altering the snippet", () => {
    const snippet = "Use ASHI-GARAMI, then ashi garami again.";
    const parts = highlightedTranscriptParts(snippet, "ashi garami");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["ASHI-GARAMI", "ashi garami"]);
    expect(parts.map((part) => part.text).join("")).toBe(snippet);
  });

  it("treats regex characters and HTML-looking transcript content as literal text", () => {
    const snippet = "<script>alert(1)</script> [arm lock]";
    const parts = highlightedTranscriptParts(snippet, "[arm lock]");
    expect(parts).toEqual([{ text: "<script>alert(1)</script> ", match: false }, { text: "[arm lock]", match: true }]);
    expect(highlightedTranscriptParts("No matching text", "  ")).toEqual([{ text: "No matching text", match: false }]);
  });
});
