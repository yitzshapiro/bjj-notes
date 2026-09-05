/** Import completed, verified subtitle checkpoints into the app by exact Drive ID. */
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";
import { neon } from "@neondatabase/serverless";

import { prepareCaptions } from "../src/lib/caption-cues";
import { CAPTION_INDEX_VERSION, saveCaptionTrack } from "../src/lib/caption-store";
import { contentMd5, planCaptionImport, type CaptionImportVideo } from "./lib/caption-import-plan";
import { mapConcurrent } from "./lib/subtitle-concurrency";
import type { DriveVideo } from "./lib/subtitle-drive";
import { acquireLock, atomicWrite, digest, loadState, readJson } from "./lib/subtitle-storage";

type StoredCaption = { video_id: string; content_hash: string; cue_count: number; last_cue_end_seconds: number; index_version: number };
type CueCount = { video_id: string; count: number; overlaps: number };

async function main() {
  const { values } = parseArgs({ options: {
    apply: { type: "boolean", default: false }, verify: { type: "boolean", default: false },
    "state-dir": { type: "string", default: ".subtitles" }, help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log(`Import corrected subtitles into the app by their checkpoint's exact video ID.

pnpm subtitles:import          Read-only preview
pnpm subtitles:import --apply  Back up replaced tracks, import and verify
pnpm subtitles:import --verify Verify all completed tracks and search indexes

Uses DATABASE_URL from .env.local. Apply the checked-in migrations first.
Only complete transcripts with matching source metadata and output hashes qualify.
Existing identical indexed captions are skipped. No transcription API is called.`);
    return;
  }
  if (values.apply && values.verify) throw new Error("Choose --apply or --verify, not both.");
  loadEnvConfig(process.cwd());
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const sql = neon(process.env.DATABASE_URL);
  const directory = path.resolve(values["state-dir"]);
  const release = await acquireLock(path.join(directory, "run.lock"));
  try {
    const state = await loadState(path.join(directory, "state.json"));
    const inventory = await readJson<{ videos: DriveVideo[] }>(path.join(directory, "inventory.json"));
    if (!inventory?.videos.length) throw new Error("No source inventory found.");
    const videos = await sql.query("SELECT id, name, path, size_bytes, duration_ms, drive_modified_at FROM drive_items WHERE item_type = $1 AND deleted_at IS NULL", ["video"]) as CaptionImportVideo[];
    const plan = planCaptionImport(state, inventory.videos, videos);
    const [schema] = await sql.query("SELECT to_regclass('public.video_caption_cues') IS NOT NULL AS ready");
    if (!schema.ready && (values.apply || values.verify)) throw new Error("Apply the caption search migration before importing or verifying.");

    const captionMetadata = async () => await sql.query(`SELECT video_id, md5(content) AS content_hash,
      cue_count, last_cue_end_seconds, COALESCE((to_jsonb(c)->>'index_version')::int, 0) AS index_version
      FROM video_captions c`) as StoredCaption[];
    const indexMetadata = async (): Promise<CueCount[]> => schema.ready ? await sql.query(`
      SELECT video_id, count(*)::int AS count,
        count(*) FILTER (WHERE previous_end > start_seconds OR end_seconds <= start_seconds)::int AS overlaps
      FROM (SELECT video_id, start_seconds, end_seconds,
        lag(end_seconds) OVER (PARTITION BY video_id ORDER BY cue_index) AS previous_end FROM video_caption_cues) c
      GROUP BY video_id`) as CueCount[] : [];
    const [stored, indexed] = await Promise.all([captionMetadata(), indexMetadata()]);
    const byId = new Map(stored.map((track) => [track.video_id, track]));
    const indexById = new Map(indexed.map((track) => [track.video_id, track]));
    const prepared = [];
    const emptyTranscripts = [];
    for (const item of plan.complete) {
      const original = await readFile(item.file, "utf8");
      if (digest(original) !== item.progress.outputHash) throw new Error(`Subtitle changed since its approved checkpoint: ${item.file}`);
      if (!original.trim()) {
        emptyTranscripts.push({ id: item.video.id, name: item.video.name, file: item.file, durationSeconds: item.progress.durationSeconds });
        continue;
      }
      let track;
      try { track = prepareCaptions(original); }
      catch (error) { throw new Error(`Cannot import ${item.video.name}: ${error instanceof Error ? error.message : "Invalid captions"}`); }
      const duration = item.progress.durationSeconds!;
      if (track.lastCueEndSeconds != null && track.lastCueEndSeconds > duration + 0.001) {
        throw new Error(`Caption exceeds the recorded video duration: ${item.video.name}`);
      }
      const contentHash = contentMd5(track.content);
      const existing = byId.get(item.video.id);
      const derived = indexById.get(item.video.id);
      const current = existing?.content_hash === contentHash && existing.cue_count === track.cueCount &&
        existing.index_version === CAPTION_INDEX_VERSION && derived?.count === track.cueCount && derived.overlaps === 0;
      prepared.push({ ...item, track, contentHash, existing, current });
    }
    const changed = prepared.filter((item) => !item.current);
    const createdAt = new Date().toISOString();
    const reportDirectory = path.join(directory, "app-import", `${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
    const report = {
      createdAt, mode: values.apply ? "apply" : values.verify ? "verify" : "preview",
      status: "prepared", videos: videos.length, completeTranscripts: prepared.length,
      cueCount: prepared.reduce((sum, item) => sum + item.track.cueCount, 0),
      alreadyImported: prepared.length - changed.length, toImport: changed.length,
      incompleteTranscripts: plan.incomplete,
      emptyTranscripts,
      files: prepared.map((item) => ({
        videoId: item.video.id, videoName: item.video.name, file: item.file,
        sourceHash: item.progress.outputHash, contentHash: item.contentHash,
        previousContentHash: item.existing?.content_hash ?? null, cueCount: item.track.cueCount,
        status: item.current ? "current" : item.existing ? "replace" : "new",
      })),
      errors: [] as { videoId: string; message: string }[],
    };
    await mkdir(reportDirectory, { recursive: true });
    const reportFile = path.join(reportDirectory, "report.json");
    await atomicWrite(reportFile, JSON.stringify(report, null, 2));
    console.log(`${prepared.length} completed transcripts (${report.cueCount.toLocaleString()} cues), ${report.alreadyImported} already current, ${changed.length} to import.`);
    console.log(`${plan.incomplete.length} unfinished source transcripts, ${emptyTranscripts.length} empty transcripts retained for review. Audit: ${reportFile}`);
    if (!values.apply) {
      report.status = values.verify && changed.length ? "failed" : values.verify ? "verified" : "preview";
      await atomicWrite(reportFile, JSON.stringify(report, null, 2));
      if (values.verify && changed.length) throw new Error(`${changed.length} caption tracks or indexes differ from completed local transcripts.`);
      if (values.verify) console.log("All caption content hashes, cue counts, index versions and non-overlap checks match.");
      return;
    }

    // Capture every track being replaced before any writes to the app.
    for (const item of changed.filter((item) => item.existing)) {
      const [before] = await sql.query("SELECT * FROM video_captions WHERE video_id = $1", [item.video.id]);
      if (!before || contentMd5(before.content) !== item.existing!.content_hash) throw new Error(`Caption changed during preview: ${item.video.name}`);
      await atomicWrite(path.join(reportDirectory, "original-captions", `${digest(item.video.id)}.json`), JSON.stringify(before, null, 2));
    }
    let completed = 0;
    await mapConcurrent(changed, 4, async (item) => {
      const receipt = report.files.find((file) => file.videoId === item.video.id)!;
      try {
        if (digest(await readFile(item.file, "utf8")) !== item.progress.outputHash) throw new Error("Local subtitle changed during import.");
        const saved = await saveCaptionTrack(sql, {
          videoId: item.video.id, fileName: `${item.source.name}.vtt`, content: item.track.content,
          expectedContentHash: item.existing?.content_hash ?? null,
        });
        if (saved.contentHash !== item.contentHash || saved.cueCount !== item.track.cueCount) throw new Error("Saved caption did not match the prepared track.");
        receipt.status = "imported";
      } catch (error) {
        receipt.status = "failed";
        report.errors.push({ videoId: item.video.id, message: error instanceof Error ? error.message : "Import failed" });
      }
      await atomicWrite(path.join(reportDirectory, "receipts", `${digest(item.video.id)}.json`), JSON.stringify(receipt, null, 2));
      completed += 1;
      if (completed % 25 === 0 || completed === changed.length) console.log(`Processed ${completed}/${changed.length} tracks; ${report.errors.length} errors.`);
    }, new AbortController().signal);

    const [after, indexAfter] = await Promise.all([captionMetadata(), indexMetadata()]);
    const finalCaptions = new Map(after.map((track) => [track.video_id, track]));
    const finalIndex = new Map(indexAfter.map((track) => [track.video_id, track]));
    for (const item of prepared) {
      const track = finalCaptions.get(item.video.id);
      const derived = finalIndex.get(item.video.id);
      if (track?.content_hash !== item.contentHash || track?.cue_count !== item.track.cueCount ||
          track?.index_version !== CAPTION_INDEX_VERSION || derived?.count !== item.track.cueCount || derived.overlaps !== 0) {
        report.errors.push({ videoId: item.video.id, message: "Final caption or search index verification failed." });
      }
    }
    report.status = report.errors.length ? "failed" : "verified";
    await atomicWrite(reportFile, JSON.stringify(report, null, 2));
    if (report.errors.length) throw new Error(`Import has ${report.errors.length} errors; inspect ${reportFile}. Rerunning skips verified tracks.`);
    console.log(`Verified all ${prepared.length} caption tracks and ${report.cueCount.toLocaleString()} indexed cues. Audit: ${reportFile}`);
  } finally { await release(); }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
