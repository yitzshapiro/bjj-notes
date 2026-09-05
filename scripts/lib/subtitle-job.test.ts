import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { command, generateVideo } from "./subtitle-job";
import type { DriveVideo } from "./subtitle-drive";
import { digest, fingerprint, loadState, outputPaths, type SubtitleState } from "./subtitle-storage";

// Exercise the actual extraction/chunking process without any API or browser.
// Generic app test environments may not have these optional CLI prerequisites.
const hasMediaTools = ["ffmpeg", "ffprobe"].every((binary) => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);

const delay = (milliseconds: number) => new Promise<void>((resolve) => { setTimeout(resolve, milliseconds); });

describe.skipIf(!hasMediaTools)("subtitle job with real media tools and offline services", () => {
  let fixtures: string;
  let fixture: string;
  let directory: string;

  beforeAll(async () => {
    fixtures = await mkdtemp(path.join(tmpdir(), "subtitle-job-fixtures-"));
    fixture = path.join(fixtures, "synthetic-video.mkv");
    await command("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", "color=c=black:s=16x16:r=4:d=2.25",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000:duration=2.25",
      "-c:v", "ffv1", "-c:a", "pcm_s16le", "-t", "2.25", fixture,
    ], new AbortController().signal);
  });

  afterAll(async () => { await rm(fixtures, { recursive: true, force: true }); });
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "subtitle-job-test-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  async function harness() {
    const video: DriveVideo = {
      id: "offline-video", name: "01. Mount Escapes.mp4.mp4",
      path: ["BJJ Library", "Mount Escapes", "01. Mount Escapes.mp4.mp4"],
      durationSeconds: 2.25, sizeBytes: (await stat(fixture)).size,
      modifiedTime: "2026-09-01T00:00:00Z",
    };
    const state: SubtitleState = { version: 1, usage: [], cooldownUntil: 0, videos: {} };
    const drive = {
      metadata: vi.fn(async () => ({ ...video, path: [...video.path] })),
      download: vi.fn(async (_video: DriveVideo, destination: string) => { await copyFile(fixture, destination); }),
    };
    let phrase = "Technique";
    const transcriber = {
      identity: { provider: "deepgram", model: "nova-3" },
      transcribe: vi.fn(async (file: string, seconds: number, language: string, prompt: string) => {
        expect(path.extname(file)).toBe(".flac");
        expect((await stat(file)).size).toBeGreaterThan(44);
        expect(language).toBe("en");
        expect(prompt).toBe("");
        const probe = JSON.parse(await command("ffprobe", [
          "-v", "error", "-show_entries", "stream=sample_rate,channels:format=duration", "-of", "json", file,
        ], new AbortController().signal)) as { streams: { sample_rate: string; channels: number }[]; format: { duration: string } };
        expect(probe.streams[0]).toEqual({ sample_rate: "16000", channels: 1 });
        expect(Number(probe.format.duration)).toBeCloseTo(seconds, 5);
        return [{ start: 0, end: seconds, text: phrase }];
      }),
    };
    const options = {
      video, output: outputPaths([video], path.join(directory, "subtitles")).get(video.id)!,
      workDirectory: path.join(directory, "checkpoint"), stateFile: path.join(directory, "checkpoint", "state.json"),
      state, drive, transcriber, chunkSeconds: 1, language: "en", concurrency: 1, signal: new AbortController().signal,
    };
    return {
      options, video, drive, transcriber,
      setPhrase(value: string) { phrase = value; },
      cacheDirectory() { return path.join(options.workDirectory, "work", fingerprint(video, options.chunkSeconds, "en", transcriber.identity)); },
      async restart() { options.state = await loadState(options.stateFile); options.signal = new AbortController().signal; },
    };
  }

  const expectedSrt = "1\n00:00:00,000 --> 00:00:01,000\nTechnique\n\n2\n00:00:01,000 --> 00:00:02,000\nTechnique\n\n3\n00:00:02,000 --> 00:00:02,250\nTechnique\n";

  it("extracts mono audio, offsets all chunks, preserves the Drive path/name, and skips a completed rerun", async () => {
    const job = await harness();
    await generateVideo(job.options);
    expect(job.options.output).toBe(path.join(directory, "subtitles", "BJJ Library", "Mount Escapes", "01. Mount Escapes.mp4.mp4.srt"));
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
    expect(job.transcriber.transcribe.mock.calls.map((call) => call[1])).toEqual([1, 1, 0.25]);
    expect(job.drive.download).toHaveBeenCalledTimes(1);
    const saved = await loadState(job.options.stateFile);
    expect(saved.videos[job.video.id]).toMatchObject({ complete: true, durationSeconds: 2.25, outputHash: digest(expectedSrt) });
    await expect(stat(path.join(job.cacheDirectory(), "audio.wav"))).rejects.toMatchObject({ code: "ENOENT" });
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await generateVideo(job.options);
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe).not.toHaveBeenCalled();
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
  });

  it("persists the first chunk before interruption and resumes only the remaining chunks using cached audio", async () => {
    const job = await harness();
    const controller = new AbortController();
    job.options.signal = controller.signal;
    job.transcriber.transcribe.mockImplementationOnce(async (_file, seconds) => {
      controller.abort(new Error("Offline simulated interruption"));
      return [{ start: 0, end: seconds, text: "Technique" }];
    });
    await expect(generateVideo(job.options)).rejects.toThrow("Offline simulated interruption");
    expect(job.transcriber.transcribe).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path.join(job.cacheDirectory(), "0.json"), "utf8"))).toEqual({ segments: [{ start: 0, end: 1, text: "Technique" }] });
    expect((await stat(path.join(job.cacheDirectory(), "audio.wav"))).size).toBeGreaterThan(44);
    await expect(stat(job.options.output)).rejects.toMatchObject({ code: "ENOENT" });
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await generateVideo(job.options);
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe.mock.calls.map((call) => call[1])).toEqual([1, 0.25]);
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
  });

  it.each([2, 4])("transcribes %s chunks concurrently with separate audio paths and orders out-of-order results", async (concurrency) => {
    const job = await harness();
    job.options.concurrency = concurrency;
    job.options.chunkSeconds = 0.5;
    const inspectAudio = job.transcriber.transcribe.getMockImplementation()!;
    let active = 0;
    let maximumActive = 0;
    let ready = 0;
    let openFirstPool!: () => void;
    const firstPoolReady = new Promise<void>((resolve) => { openFirstPool = resolve; });
    const completed: number[] = [];
    const files = new Set<string>();
    job.transcriber.transcribe.mockImplementation(async (file, seconds, language, prompt) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      expect(files.has(file)).toBe(false);
      files.add(file);
      const index = Number(path.basename(file).match(/^chunk-(\d+)\.flac$/)![1]);
      const originalAudio = await readFile(file);
      await inspectAudio(file, seconds, language, prompt);
      ready += 1;
      if (ready === concurrency) openFirstPool();
      await firstPoolReady;
      // Starting the initial requests together makes reverse completion reliable
      // while the short, filename-based delays keep the integration test bounded.
      await delay((concurrency - index % concurrency) * 20);
      expect(await readFile(file)).toEqual(originalAudio);
      active -= 1;
      completed.push(index);
      return [{ start: 0, end: seconds, text: `Chunk ${index}` }];
    });
    await generateVideo(job.options);
    expect(files.size).toBe(5);
    expect(maximumActive).toBe(concurrency);
    expect(active).toBe(0);
    expect(completed[0]).toBe(concurrency - 1);
    expect(await readFile(job.options.output, "utf8")).toBe(
      "1\n00:00:00,000 --> 00:00:00,500\nChunk 0\n\n" +
      "2\n00:00:00,500 --> 00:00:01,000\nChunk 1\n\n" +
      "3\n00:00:01,000 --> 00:00:01,500\nChunk 2\n\n" +
      "4\n00:00:01,500 --> 00:00:02,000\nChunk 3\n\n" +
      "5\n00:00:02,000 --> 00:00:02,250\nChunk 4\n",
    );
    for (const file of files) await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await loadState(job.options.stateFile)).videos[job.video.id].complete).toBe(true);
  });

  it("drains and saves successful sibling chunks on failure, then resumes only missing chunks", async () => {
    const job = await harness();
    job.options.concurrency = 2;
    const inspectAudio = job.transcriber.transcribe.getMockImplementation()!;
    const failure = new Error("Offline chunk 0 failed");
    let ready = 0;
    let openFirstPool!: () => void;
    const firstPoolReady = new Promise<void>((resolve) => { openFirstPool = resolve; });
    let successfulSiblingFinished = false;
    job.transcriber.transcribe.mockImplementation(async (file, seconds, language, prompt) => {
      const segments = await inspectAudio(file, seconds, language, prompt);
      ready += 1;
      if (ready === 2) openFirstPool();
      await firstPoolReady;
      if (path.basename(file) === "chunk-0.flac") throw failure;
      await delay(40);
      successfulSiblingFinished = true;
      return segments;
    });
    await expect(generateVideo(job.options)).rejects.toBe(failure);
    expect(successfulSiblingFinished).toBe(true);
    expect(job.transcriber.transcribe).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await readFile(path.join(job.cacheDirectory(), "1.json"), "utf8"))).toEqual({
      segments: [{ start: 0, end: 1, text: "Technique" }],
    });
    await expect(stat(path.join(job.cacheDirectory(), "0.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(job.cacheDirectory(), "2.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(job.options.output)).rejects.toMatchObject({ code: "ENOENT" });

    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear().mockImplementation(inspectAudio);
    await generateVideo(job.options);
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe.mock.calls.map(([file]) => path.basename(file)).sort()).toEqual(["chunk-0.flac", "chunk-2.flac"]);
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
  });

  it("reconstructs a missing output entirely from completed chunk checkpoints", async () => {
    const job = await harness();
    await generateVideo(job.options);
    await rm(job.options.output);
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await generateVideo(job.options);
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe).not.toHaveBeenCalled();
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
  });

  it("invalidates cached audio and transcripts when the source video changes", async () => {
    const job = await harness();
    await generateVideo(job.options);
    const oldFingerprint = job.options.state.videos[job.video.id].fingerprint;
    job.video.modifiedTime = "2026-09-05T00:00:00Z";
    job.setPhrase("Updated technique");
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await generateVideo(job.options);
    expect(job.drive.download).toHaveBeenCalledTimes(1);
    expect(job.transcriber.transcribe).toHaveBeenCalledTimes(3);
    expect(job.options.state.videos[job.video.id].fingerprint).not.toBe(oldFingerprint);
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt.replaceAll("Technique", "Updated technique"));
  });

  it("preserves manually edited completed SRTs", async () => {
    const job = await harness();
    await generateVideo(job.options);
    await writeFile(job.options.output, "Manually corrected subtitles\n");
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await expect(generateVideo(job.options)).rejects.toThrow("Existing SRT was edited");
    expect(await readFile(job.options.output, "utf8")).toBe("Manually corrected subtitles\n");
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe).not.toHaveBeenCalled();
  });

  it("preserves pre-existing SRTs that were not created by this checkpoint", async () => {
    const job = await harness();
    await mkdir(path.dirname(job.options.output), { recursive: true });
    await writeFile(job.options.output, "Existing untracked subtitles\n");
    await expect(generateVideo(job.options)).rejects.toThrow("Refusing to replace an untracked or edited file");
    expect(await readFile(job.options.output, "utf8")).toBe("Existing untracked subtitles\n");
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe).not.toHaveBeenCalled();
  });

  it.each(["before", "after"] as const)("recovers a checkpoint saved %s output publication with pendingOutputHash", async (when) => {
    const job = await harness();
    await generateVideo(job.options);
    const saved = await loadState(job.options.stateFile);
    saved.videos[job.video.id].complete = false;
    saved.videos[job.video.id].outputHash = digest("Previous generated subtitles\n");
    saved.videos[job.video.id].pendingOutputHash = digest(expectedSrt);
    await writeFile(job.options.stateFile, JSON.stringify(saved));
    if (when === "before") await writeFile(job.options.output, "Previous generated subtitles\n");
    await job.restart();
    job.drive.download.mockClear();
    job.transcriber.transcribe.mockClear();
    await generateVideo(job.options);
    expect(await readFile(job.options.output, "utf8")).toBe(expectedSrt);
    expect(job.drive.download).not.toHaveBeenCalled();
    expect(job.transcriber.transcribe).not.toHaveBeenCalled();
    const finished = (await loadState(job.options.stateFile)).videos[job.video.id];
    expect(finished).toMatchObject({ complete: true, outputHash: digest(expectedSrt) });
    expect(finished.pendingOutputHash).toBeUndefined();
  });
});

describe("subprocess cancellation", () => {
  it("does not reject until an aborted subprocess finishes writing and exits", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "subtitle-command-test-"));
    const readyFile = path.join(directory, "ready");
    const stoppedFile = path.join(directory, "stopped");
    const controller = new AbortController();
    // The child deliberately keeps running briefly after SIGTERM. A command
    // promise rejected on 'error' instead of 'close' would release too early.
    const script = `
      const fs = require('node:fs');
      process.on('SIGTERM', () => setTimeout(() => {
        fs.writeFileSync(${JSON.stringify(stoppedFile)}, 'finished');
        process.exit(0);
      }, 100));
      fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready');
      setTimeout(() => process.exit(1), 3000);
    `;
    let settled = false;
    const running = command(process.execPath, ["-e", script], controller.signal);
    const rejection = expect(running).rejects.toThrow(/Could not run/);
    void running.then(() => { settled = true; }, () => { settled = true; });
    try {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try { await stat(readyFile); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await delay(10);
        }
      }
      expect(await readFile(readyFile, "utf8")).toBe("ready");
      controller.abort();
      await delay(20);
      expect(settled).toBe(false);
      await rejection;
      expect(await readFile(stoppedFile, "utf8")).toBe("finished");
    } finally {
      controller.abort();
      await running.catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  });
});
