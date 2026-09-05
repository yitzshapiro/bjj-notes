import { planChunks } from "./subtitle-core";
import type { DriveVideo } from "./subtitle-drive";

export function estimateDeepgram(videos: DriveVideo[], options: {
  chunkSeconds: number;
  concurrency: number;
  language: string;
  availableCreditUSD?: number;
  downloadMbps?: number;
  requestSeconds?: number;
}) {
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 50) {
    throw new Error("Concurrency must be an integer from 1 to 50.");
  }
  if (!Number.isFinite(options.chunkSeconds) || options.chunkSeconds <= 0) throw new Error("Chunk duration must be positive.");
  for (const name of ["availableCreditUSD", "downloadMbps", "requestSeconds"] as const) {
    const value = options[name];
    if (value != null && (!Number.isFinite(value) || value < (name === "availableCreditUSD" ? 0 : Number.EPSILON))) {
      throw new Error(`${name} must be ${name === "availableCreditUSD" ? "nonnegative" : "positive"}.`);
    }
  }
  const known = videos.filter((video) => video.durationSeconds != null && Number.isFinite(video.durationSeconds) && video.durationSeconds > 0);
  const knownIds = new Set(known.map((video) => video.id));
  const audioSeconds = known.reduce((sum, video) => sum + video.durationSeconds!, 0);
  const counts = known.map((video) => planChunks(video.durationSeconds!, options.chunkSeconds).length);
  const bytes = videos.reduce((sum, video) => sum + (video.sizeBytes ?? 0), 0);
  // Nova-3 monolingual pre-recorded list price. Language auto-detection can route
  // to another model; use the higher multilingual rate as an explicit allowance.
  const pricePerMinuteUSD = options.language === "auto" ? 0.0052 : 0.0043;
  const estimatedCostUSD = audioSeconds / 60 * pricePerMinuteUSD;
  return {
    provider: "deepgram", model: "nova-3", language: options.language,
    videos: videos.length, knownDurationVideos: known.length,
    unknownDurationVideos: videos.length - known.length,
    unknownVideos: videos.filter((video) => !knownIds.has(video.id)).map((video) => ({ id: video.id, path: video.path })),
    knownAudioHours: audioSeconds / 3600, knownDownloadGB: bytes / 1e9,
    missingSizeVideos: videos.filter((video) => video.sizeBytes == null).length,
    chunkSeconds: options.chunkSeconds, requestsForKnownVideos: counts.reduce((sum, count) => sum + count, 0),
    concurrency: options.concurrency, publishedConcurrencyLimit: 50,
    pricePerMinuteUSD, estimatedCostUSD,
    providedCreditUSD: options.availableCreditUSD ?? null,
    estimatedCostAfterProvidedCreditUSD: options.availableCreditUSD == null ? null : Math.max(0, estimatedCostUSD - options.availableCreditUSD),
    downloadMbps: options.downloadMbps ?? null,
    transferOnlyHours: options.downloadMbps == null ? null : bytes * 8 / (options.downloadMbps * 1e6 * 3600),
    assumedSecondsPerChunk: options.requestSeconds ?? null,
    processingScenarioHours: options.requestSeconds == null ? null
      : counts.reduce((sum, count) => sum + Math.ceil(count / options.concurrency), 0) * options.requestSeconds / 3600,
    assumptions: [
      "Full selected inventory, including completed SRTs; missing/zero durations excluded.",
      "Credit is a user-provided estimate, not an account balance check or billing cap.",
      "Deepgram concurrent request limits and 429 retries apply; no daily quota wait is simulated.",
      "Default English uses Nova-3 monolingual, with no paid add-ons. Auto language may change the selected model.",
      "Cost excludes retries and unmeasured videos. No live throughput has been measured.",
      "Optional timing scenarios use supplied speeds; video downloads are sequential, chunks run concurrently within each video.",
      "Transfer time covers source downloads only; API uploads, extraction, latency and retries are additional.",
    ],
  };
}
