import { describe, expect, it, vi } from "vitest";

import { parseCaptionSearchParams, searchCaptions } from "./caption-search";
import type { CaptionSql } from "./caption-store";

describe("caption search input", () => {
  it("normalizes attested Japanese spellings and whitespace", () => {
    expect(parseCaptionSearchParams(new URLSearchParams({ q: "  sumi   gage " })))
      .toEqual({ query: "sumi gage", normalizedQuery: "sumi gaeshi", limit: 20, offset: 0 });
  });

  it.each(["", "a", "---", "x".repeat(121)])("rejects unusable search %j", (q) => {
    expect(() => parseCaptionSearchParams(new URLSearchParams({ q }))).toThrow();
  });

  it.each([["limit", "0"], ["limit", "51"], ["limit", "1.5"], ["offset", "-1"], ["offset", "10001"], ["offset", "NaN"]])("bounds pagination %s=%s", (key, value) => {
    expect(() => parseCaptionSearchParams(new URLSearchParams({ q: "ashi", [key]: value }))).toThrow();
  });

  it("retains a valid explicit zero offset", () => {
    expect(parseCaptionSearchParams(new URLSearchParams({ q: "ashi", offset: "0", limit: "50" }))).toMatchObject({ offset: 0, limit: 50 });
  });
});

describe("caption search response", () => {
  it("binds user text and returns plain snippets, video titles, accurate zero-time links and pagination", async () => {
    const hit = { videoId: "video/id", videoName: "Leg locks volume 1", path: ["Gordon Ryan", "Leg locks"], startSeconds: 0, endSeconds: 2.4, snippet: "Enter ashi garami." };
    const sql = vi.fn().mockResolvedValue([{ total: 42, results: [hit] }]);
    const input = parseCaptionSearchParams(new URLSearchParams({ q: "ashi'; DROP TABLE videos; --", limit: "1" }));
    const result = await searchCaptions(sql as unknown as CaptionSql, input);
    expect(sql).toHaveBeenCalledOnce();
    const [strings, ...params] = sql.mock.calls[0];
    expect(strings.join("")).not.toContain(input.query);
    expect(params).toEqual([input.normalizedQuery, input.normalizedQuery, 1, 0]);
    expect(result).toMatchObject({ total: 42, nextOffset: 1, results: [{ ...hit, href: "/library/video%2Fid?t=0" }] });
  });

  it("keeps the total when a page is empty and stops pagination at the bound", async () => {
    const sql = vi.fn().mockResolvedValue([{ total: 3, results: [] }]);
    const input = parseCaptionSearchParams(new URLSearchParams({ q: "ashi", offset: "20" }));
    expect(await searchCaptions(sql as unknown as CaptionSql, input)).toMatchObject({ total: 3, results: [], nextOffset: null });
    sql.mockResolvedValue([{ total: 20_000, results: [{ videoId: "v", startSeconds: 1 }] }]);
    expect(await searchCaptions(sql as unknown as CaptionSql, { ...input, offset: 10_000 })).toMatchObject({ nextOffset: null });
  });
});
