/** Standalone Drive -> Deepgram Nova-3 -> local SRT. Defaults to estimate. */
import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";
import path from "node:path";
import { parseArgs } from "node:util";

import { estimateDeepgram } from "./lib/subtitle-estimate";
import { authorizeDrive, SubtitleDriveClient, type DriveVideo } from "./lib/subtitle-drive";
import { DeepgramFatalError, DeepgramTranscriber } from "./lib/subtitle-deepgram";
import {
  acquireLock, atomicWrite, loadState, outputPaths, saveState,
} from "./lib/subtitle-storage";

import { command, generateVideo } from "./lib/subtitle-job";

loadEnvConfig(process.cwd());

const HELP = `Create local .srt files with Deepgram Nova-3 for the Drive video library.
Drive and Neon are read-only. Default behavior is a metadata-only estimate.

pnpm subtitles:auth                    Authorize read-only Drive downloads once
pnpm subtitles:estimate                Estimate using the saved Neon inventory
pnpm subtitles:estimate --source drive Estimate using fresh Drive metadata
pnpm subtitles:generate --limit 1      Generate the first video; reruns resume
pnpm subtitles:generate                Generate the whole library

Options:
  --auth                  One-time Google consent (temporary loopback callback)
  --estimate              No media downloads or Deepgram API calls (default)
  --run                   Download, transcribe and save local SRTs
  --source database|drive Inventory source (database for estimate, drive for run)
  --concurrency N         Simultaneous chunks per video, 1..50 (default: 4)
  --chunk-seconds N       Chunk duration, 1..720 (default: 600, lossless FLAC)
  --language CODE         Two-letter audio language, or auto (default: en)
  --video-id ID           Select one exact Drive video ID
  --limit N               Select first N videos in Drive path order
  --output DIR            Output directory (default: ./subtitles)
  --credit-usd N          Available credit for the estimate only; not a billing cap
  --download-mbps N       Optional sustained download speed for a timing scenario
  --request-seconds N     Optional measured/assumed seconds per chunk for timing
  --json                  Print the estimate as JSON
  --help                  Show help

Generation requires ffmpeg/ffprobe, DEEPGRAM_API_KEY and Drive authorization.
This script uses Nova-3 with no paid add-ons. A valid key alone does not start it.
Checkpoints and request history live in .subtitles/; rerun to resume. Keep one job
per checkout and stay within your project's actual Deepgram concurrency limit.
See docs/subtitles.md for setup, pricing and recovery.
`;

function integer(value: string | undefined, fallback: number, name: string) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }
  return Number(value);
}

async function databaseInventory(rootId: string): Promise<{ videos: DriveVideo[]; syncedAt: string | null }> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for a saved-inventory estimate; use --source drive instead.");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql.query(`
    with recursive library as (
      select id from drive_items where id = $1 and deleted_at is null
      union
      select d.id from drive_items d join library p on d.parent_id = p.id where d.deleted_at is null
    )
    select d.id, d.name, d.path, d.duration_ms, d.size_bytes, d.drive_modified_at, d.synced_at
    from drive_items d join library l on l.id = d.id
    where d.item_type = 'video' and d.deleted_at is null and left(d.name, 2) <> '._'
    order by d.path, d.id`, [rootId]);
  const videos = rows.map((row) => ({
    id: String(row.id), name: String(row.name), path: row.path as string[],
    durationSeconds: Number(row.duration_ms) > 0 ? Number(row.duration_ms) / 1000 : null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    modifiedTime: row.drive_modified_at ? new Date(row.drive_modified_at).toISOString() : null,
  }));
  return { videos, syncedAt: rows.map((row) => new Date(row.synced_at).toISOString()).sort()[0] ?? null };
}

async function main() {
  const { values } = parseArgs({ options: {
    auth: { type: "boolean" }, estimate: { type: "boolean" }, run: { type: "boolean" }, help: { type: "boolean" }, json: { type: "boolean" },
    source: { type: "string" }, concurrency: { type: "string" },
    "chunk-seconds": { type: "string" }, language: { type: "string", default: "en" },
    "credit-usd": { type: "string" }, "download-mbps": { type: "string" }, "request-seconds": { type: "string" },
    "video-id": { type: "string" }, limit: { type: "string" }, output: { type: "string", default: "subtitles" },
  } });
  if (values.help) { console.log(HELP); return; }
  if ([values.auth, values.estimate, values.run].filter(Boolean).length > 1) throw new Error("Choose only one of --auth, --estimate, --run.");
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const { signal } = controller;
  const workDirectory = path.resolve(".subtitles");
  const authFile = path.join(workDirectory, "google-auth.json");
  try {
    if (values.auth) { await authorizeDrive(authFile, signal); return; }
    const rootId = process.env.DRIVE_ROOT_FOLDER_ID?.trim();
    if (!rootId) throw new Error("DRIVE_ROOT_FOLDER_ID is required.");
    const concurrency = integer(values.concurrency, 4, "concurrency");
    if (concurrency > 50) throw new Error("--concurrency cannot exceed Deepgram's published 50-request ceiling.");
    const optionalNumber = (value: string | undefined) => value === undefined ? undefined : value.trim() ? Number(value) : NaN;
    const chunkSeconds = integer(values["chunk-seconds"], 600, "chunk-seconds");
    if (chunkSeconds > 720) throw new Error("--chunk-seconds cannot exceed 720 (keeps lossless uploads below 25 MB).");
    if (!/^(auto|[a-z]{2})$/.test(values.language!)) throw new Error("--language must be a two-letter language code or auto.");
    const source = values.source ?? (values.run ? "drive" : "database");
    if (!["database", "drive"].includes(source)) throw new Error("--source must be database or drive.");
    if (values.run && !process.env.DEEPGRAM_API_KEY?.trim()) throw new Error("Set DEEPGRAM_API_KEY in .env.local before generation.");
    const drive = new SubtitleDriveClient({ authFile, signal });
    const inventory = source === "drive" ? { videos: await drive.listVideos(rootId), syncedAt: null } : await databaseInventory(rootId);
    let videos = inventory.videos.sort((left, right) => left.path.join("/").localeCompare(right.path.join("/"), "en", { numeric: true }) || left.id.localeCompare(right.id));
    const paths = outputPaths(videos, path.resolve(values.output!));
    if (values["video-id"]) videos = videos.filter((video) => video.id === values["video-id"]);
    if (values.limit) videos = videos.slice(0, integer(values.limit, 1, "limit"));
    if (!videos.length) throw new Error("No videos found in the configured root/selection. Sync the app inventory or check Drive authorization.");
    const report = { source, inventorySyncedAt: inventory.syncedAt, ...estimateDeepgram(videos, {
      chunkSeconds, concurrency, language: values.language!,
      availableCreditUSD: optionalNumber(values["credit-usd"]),
      downloadMbps: optionalNumber(values["download-mbps"]), requestSeconds: optionalNumber(values["request-seconds"]),
    }) };
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.videos} videos; ${report.knownAudioHours.toFixed(2)} known audio hours; ${report.unknownDurationVideos} unknown/zero durations.`);
      console.log(`Inventory: ${source}${inventory.syncedAt ? `, saved ${inventory.syncedAt}` : " (live)"}; download size ${report.knownDownloadGB.toFixed(2)} GB.`);
      console.log(`${report.requestsForKnownVideos} requests for known durations at ${chunkSeconds}s/chunk; up to ${concurrency} concurrent chunks per video.`);
      console.log(`Deepgram Nova-3 estimated API usage: $${report.estimatedCostUSD.toFixed(2)} before credits, at $${report.pricePerMinuteUSD}/audio minute.`);
      if (report.estimatedCostAfterProvidedCreditUSD != null) {
        console.log(`With your supplied $${report.providedCreditUSD!.toFixed(2)} credit estimate: $${report.estimatedCostAfterProvidedCreditUSD.toFixed(2)} out of pocket. Account balance was not checked.`);
      }
      if (report.transferOnlyHours != null) console.log(`Source download scenario: ${report.transferOnlyHours.toFixed(2)}h at ${report.downloadMbps} Mbps, before extraction/uploads/API work.`);
      if (report.processingScenarioHours != null) console.log(`Chunk processing scenario: ${report.processingScenarioHours.toFixed(2)}h at ${report.assumedSecondsPerChunk}s/chunk with ${concurrency} workers, before source downloads.`);
      console.log("Deepgram limits concurrent requests. Actual completion time needs a measured throughput sample.");
      if (values.language === "auto") console.log("Auto language can select a fallback model; this estimate uses a multilingual price allowance. Use --language en for Nova-3 English.");
      console.log("Estimates exclude missing durations and retries, and cover the entire selection rather than just unfinished work.");
    }
    if (!values.run) return;
    await command("ffmpeg", ["-version"], signal);
    await command("ffprobe", ["-version"], signal);
    const release = await acquireLock(path.join(workDirectory, "run.lock"));
    try {
      const stateFile = path.join(workDirectory, "state.json");
      const state = await loadState(stateFile);
      const transcriber = new DeepgramTranscriber({
        apiKey: process.env.DEEPGRAM_API_KEY!.trim(), signal,
        onAttempt: async (seconds) => {
          state.usage = state.usage.filter((entry) => entry.at > Date.now() - 86_400_000);
          state.usage.push({ at: Date.now(), seconds });
          await saveState(stateFile, state);
        },
      });
      await atomicWrite(path.join(workDirectory, "inventory.json"), JSON.stringify({ ...inventory, videos }, null, 2));
      let failures = 0;
      for (const [index, video] of videos.entries()) {
        signal.throwIfAborted();
        console.log(`\nVideo ${index + 1}/${videos.length}`);
        try {
          await generateVideo({ video, output: paths.get(video.id)!, workDirectory, stateFile, state, drive, transcriber,
            chunkSeconds, language: values.language!, concurrency, signal });
        } catch (error) {
          signal.throwIfAborted();
          if (transcriber.failure) throw transcriber.failure;
          if (error instanceof DeepgramFatalError) throw error;
          failures += 1;
          const message = error instanceof Error ? error.message : String(error);
          console.error(`Failed ${video.path.join(" / ")}: ${message}`);
          if (state.videos[video.id]) state.videos[video.id].error = message;
          await saveState(stateFile, state);
        }
      }
      console.log(`\nFinished: ${videos.length - failures} complete, ${failures} failed. Rerun the same command to resume failures.`);
      if (failures) process.exitCode = 1;
    } finally {
      await release();
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  if (error?.name === "AbortError") {
    console.error("Stopped. Completed chunks and request history are saved; rerun to resume.");
    process.exitCode = 130;
  } else {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
