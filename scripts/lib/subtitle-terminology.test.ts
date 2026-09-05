import { describe, expect, it } from "vitest";
import { normalizeJapaneseTerms } from "./subtitle-terminology";
import { renderSrt } from "./subtitle-core";

describe("Japanese terminology corrections", () => {
  it("normalizes observed ASR variants and retains English plural and possessive suffixes", () => {
    const result = normalizeJapaneseTerms("Ashigurami, sumigeshi's and judikitamis lead to senkaku.");
    expect(result.text).toBe("Ashi garami, sumi gaeshi's and juji gatames lead to sankaku.");
    expect(result.replacements).toHaveLength(4);
    expect(result.replacements[0]).toEqual({ from: "Ashigurami", to: "Ashi garami", canonical: "ashi garami", offset: 0 });
  });

  it("preserves ordinary English, proper names and correct searchable capitalization", () => {
    const original = "Assuming this fashion, Kazushi Sakuraba uses Ashi Garami. The sumi and ashi entries differ.";
    expect(normalizeJapaneseTerms(original)).toEqual({ text: original, replacements: [] });
    expect(normalizeJapaneseTerms("Kazushi breaks his balance.").text).toBe("Kuzushi breaks his balance.");
  });

  it("matches whole words, common hyphenation and uppercase", () => {
    expect(normalizeJapaneseTerms("ASHIGURAMI, ashi-garami, ashi‐garami; xashiguramix").text)
      .toBe("ASHI GARAMI, ashi garami, ashi garami; xashiguramix");
  });

  it("is idempotent so repeated passes do not accumulate edits", () => {
    const once = normalizeJapaneseTerms("Ashigurami and sumigeshi lead to senkaku.").text;
    expect(normalizeJapaneseTerms(once)).toEqual({ text: once, replacements: [] });
  });

  it("retains distinct technique families and resolves a full modifier before its embedded alias", () => {
    expect(normalizeJapaneseTerms("Rimi Ashigurami; Oshiro Senkaku; kisikatame; hizikatame; urigeshi; urigatami.").text)
      .toBe("Irimi ashi garami; Ushiro sankaku; kesa gatame; hiza gatame; ude gaeshi; ude gatame.");
    expect(normalizeJapaneseTerms("ko chigari, old chigari, de ashi harai, ashi harai").text)
      .toBe("kouchi gari, ouchi gari, de ashi harai, ashi harai");
    expect(normalizeJapaneseTerms("Natsudashigirawi, Ashiyatoshi, sushi, Enrico Coco").replacements).toEqual([]);
  });

  it("also corrects rebuilt subtitles without changing source response segments or timing", () => {
    const segments = [{ start: 1.23, end: 3.45, text: "Ashigurami to sumigeshi." }];
    const srt = renderSrt([{ start: 600, duration: 10, segments }]);
    expect(srt).toBe("1\n00:10:01,230 --> 00:10:03,450\nAshi garami to sumi gaeshi.\n");
    expect(segments[0].text).toBe("Ashigurami to sumigeshi.");
  });
});
