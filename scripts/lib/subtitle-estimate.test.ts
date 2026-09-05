import { describe, expect, it } from "vitest";

import { estimateDeepgram } from "./subtitle-estimate";
import type { DriveVideo } from "./subtitle-drive";

const video = (id: string, seconds: number | null): DriveVideo => ({
  id, name: `${id}.mp4`, path: ["Library", `${id}.mp4`],
  durationSeconds: seconds, sizeBytes: 1e9, modifiedTime: null,
});
const options = { chunkSeconds: 600, concurrency: 4, language: "en" };

describe("Deepgram workload estimate", () => {
  it("prices audio duration, counts per-video chunks, and excludes missing or zero durations", () => {
    const result = estimateDeepgram([video("hour", 3600), video("tail", 600.5), video("zero", 0), video("unknown", null)], options);
    expect(result.knownDurationVideos).toBe(2);
    expect(result.unknownDurationVideos).toBe(2);
    expect(result.requestsForKnownVideos).toBe(8);
    expect(result.estimatedCostUSD).toBeCloseTo(4200.5 / 60 * 0.0043);
    expect(result.provider).toBe("deepgram");
    expect(result.model).toBe("nova-3");
    expect(result.estimatedCostAfterProvidedCreditUSD).toBeNull();
    expect(result.transferOnlyHours).toBeNull();
    expect(result.processingScenarioHours).toBeNull();
  });

  it("does not assume a signup credit and only subtracts an explicitly supplied balance", () => {
    const library = [video("all", 408 * 3600)];
    expect(estimateDeepgram(library, options).estimatedCostUSD).toBeCloseTo(105.264);
    expect(estimateDeepgram(library, { ...options, availableCreditUSD: 200 }).estimatedCostAfterProvidedCreditUSD).toBe(0);
    expect(estimateDeepgram(library, { ...options, availableCreditUSD: 100 }).estimatedCostAfterProvidedCreditUSD).toBeCloseTo(5.264);
    expect(estimateDeepgram(library, { ...options, availableCreditUSD: 0 }).estimatedCostAfterProvidedCreditUSD).toBeCloseTo(105.264);
  });

  it("keeps timing scenarios explicit and accounts for sequential videos with parallel chunks", () => {
    const result = estimateDeepgram([video("a", 3000), video("b", 600)], { ...options, requestSeconds: 30, downloadMbps: 100 });
    expect(result.processingScenarioHours).toBe(90 / 3600); // two waves for a, one for b
    expect(result.transferOnlyHours).toBe(2e9 * 8 / 100e6 / 3600);
    expect(result.assumedSecondsPerChunk).toBe(30);
  });

  it("uses a higher explicit price allowance when language detection can change models", () => {
    expect(estimateDeepgram([video("a", 3600)], { ...options, language: "auto" }).estimatedCostUSD).toBeCloseTo(0.312);
  });

  it("rejects impossible concurrency and nonsensical scenario inputs", () => {
    for (const concurrency of [0, -1, 1.5, 51, NaN]) expect(() => estimateDeepgram([], { ...options, concurrency })).toThrow();
    for (const value of [0, -1, NaN, Infinity]) {
      expect(() => estimateDeepgram([], { ...options, requestSeconds: value })).toThrow();
      expect(() => estimateDeepgram([], { ...options, downloadMbps: value })).toThrow();
      expect(() => estimateDeepgram([], { ...options, chunkSeconds: value })).toThrow();
    }
    expect(() => estimateDeepgram([], { ...options, availableCreditUSD: -1 })).toThrow();
  });
});
