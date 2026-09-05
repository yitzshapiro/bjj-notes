import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import { parseTranscript, planChunks, renderSrt, type Transcriber } from "./subtitle-core";
import type { SubtitleDriveClient, DriveVideo } from "./subtitle-drive";
import { mapConcurrent } from "./subtitle-concurrency";
import { atomicWrite, digest, fingerprint, readJson, saveState, type SubtitleState } from "./subtitle-storage";

async function exists(file: string) {
  try { await access(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

export async function command(binary: string, args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { signal, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    let childError: Error | undefined;
    child.stdout.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16_000); });
    child.stderr.on("data", (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-2000); });
    child.on("error", (error) => { childError = new Error(`Could not run ${binary}: ${error.message}`); });
    // AbortError can precede process exit. Wait for closed stdio before letting
    // the worker pool release the lock or reuse a chunk's output path.
    child.on("close", (code) => childError ? reject(childError)
      : code === 0 ? resolve(output) : reject(new Error(`${binary} failed (${code}): ${errors}`)));
  });
}

async function audioDuration(file: string, signal: AbortSignal) {
  const seconds = Number((await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file], signal)).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("ffprobe found no valid audio duration.");
  return seconds;
}

export async function generateVideo(options: {
  video: DriveVideo; output: string; workDirectory: string; stateFile: string;
  state: SubtitleState; drive: Pick<SubtitleDriveClient, "metadata" | "download">; transcriber: Transcriber;
  chunkSeconds: number; language: string; concurrency: number; signal: AbortSignal;
}) {
  const { drive, state, stateFile, signal, chunkSeconds, language, transcriber } = options;
  // Re-read the source version immediately before downloading or trusting a
  // checkpoint. A changed file must never reuse an old transcript.
  const video = await drive.metadata(options.video);
  const key = fingerprint(video, chunkSeconds, language, transcriber.identity);
  let progress = state.videos[video.id];
  if (progress?.fingerprint === key && progress.complete && progress.output === options.output && await exists(options.output)) {
    if (digest(await readFile(options.output, "utf8")) === progress.outputHash) {
      console.log(`Already complete: ${video.path.join(" / ")}`);
      return;
    }
    throw new Error(`Existing SRT was edited: ${options.output}. Move it aside before regenerating.`);
  }
  if (await exists(options.output)) {
    const existingHash = digest(await readFile(options.output, "utf8"));
    if (progress?.output !== options.output ||
        (existingHash !== progress.outputHash && existingHash !== progress.pendingOutputHash)) {
      throw new Error(`Refusing to replace an untracked or edited file: ${options.output}`);
    }
  }
  if (!progress || progress.fingerprint !== key) {
    progress = { fingerprint: key, output: options.output, outputHash: progress?.outputHash,
      pendingOutputHash: progress?.pendingOutputHash };
    state.videos[video.id] = progress;
  }
  progress.complete = false;
  progress.output = options.output;
  delete progress.error;
  await saveState(stateFile, state);

  const directory = path.join(options.workDirectory, "work", key);
  await mkdir(directory, { recursive: true });
  const audioFile = path.join(directory, "audio.wav");
  if (!progress.durationSeconds || !await exists(audioFile)) {
    // Only materialize another video if a chunk is still missing. Completed
    // chunks can reconstruct a deleted SRT without another API call/download.
    const cached = progress.durationSeconds && await Promise.all(
      planChunks(progress.durationSeconds, chunkSeconds).map((chunk) => exists(path.join(directory, `${chunk.index}.json`))),
    );
    if (!cached || cached.some((present) => !present)) {
      const original = path.join(directory, "source-video");
      console.log(`Downloading: ${video.path.join(" / ")}`);
      await drive.download(video, original);
      const current = await drive.metadata(video);
      if (fingerprint(current, chunkSeconds, language, transcriber.identity) !== key) throw new Error("Drive video changed during download; rerun to use its new version.");
      const temporaryAudio = path.join(directory, "audio.partial.wav");
      await command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", original,
        "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", temporaryAudio], signal);
      progress.durationSeconds = await audioDuration(temporaryAudio, signal);
      await rename(temporaryAudio, audioFile);
      await saveState(stateFile, state);
      await rm(original, { force: true });
    }
  }
  const chunks = planChunks(progress.durationSeconds!, chunkSeconds);
  const transcripts = await mapConcurrent(chunks, options.concurrency, async (chunk) => {
    signal.throwIfAborted();
    const resultFile = path.join(directory, `${chunk.index}.json`);
    let result = await readJson<unknown>(resultFile);
    if (result === undefined) {
      const chunkFile = path.join(directory, `chunk-${chunk.index}.flac`);
      await command("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", String(chunk.start),
        "-i", audioFile, "-t", String(chunk.duration), "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "flac", "-threads", "1", chunkFile], signal);
      const actualSeconds = await audioDuration(chunkFile, signal);
      console.log(`Transcribing chunk ${chunk.index + 1}/${chunks.length}: ${video.name}`);
      const segments = await transcriber.transcribe(chunkFile, actualSeconds, language, "");
      // Reject unusable timestamps before accepting this chunk as completed.
      if (segments.some((segment) => segment.text.trim()) && !renderSrt([{ ...chunk, segments }])) {
        throw new Error("Transcription provider returned speech outside this chunk's time range.");
      }
      result = { segments };
      await atomicWrite(resultFile, JSON.stringify(result));
      await rm(chunkFile, { force: true });
    }
    return { ...chunk, segments: parseTranscript(result) };
  }, signal);
  const srt = renderSrt(transcripts);
  const current = await drive.metadata(video);
  if (fingerprint(current, chunkSeconds, language, transcriber.identity) !== key) throw new Error("Drive video changed during transcription; rerun to use its new version.");
  if (await exists(options.output)) {
    const existingHash = digest(await readFile(options.output, "utf8"));
    if (existingHash !== progress.outputHash && existingHash !== progress.pendingOutputHash) {
      throw new Error(`SRT was edited while this job ran: ${options.output}. Move it aside before resuming.`);
    }
  }
  // Valid silence produces an empty SRT; retain its explicit completion record.
  if (!srt) console.log(`No speech detected: writing an empty SRT for ${video.name}`);
  // Persist both expected hashes before publishing, so a crash on either side
  // of the file rename can resume without treating our own SRT as user edits.
  progress.pendingOutputHash = digest(srt);
  await saveState(stateFile, state);
  await atomicWrite(options.output, srt);
  progress.complete = true;
  progress.outputHash = progress.pendingOutputHash;
  delete progress.pendingOutputHash;
  await saveState(stateFile, state);
  await rm(audioFile, { force: true });
  console.log(`Saved: ${options.output}`);
}
