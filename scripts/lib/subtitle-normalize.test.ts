import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { correctSubtitleFiles, normalizeSubtitleDocument, subtitleStructure, type TermNormalizer } from "./subtitle-normalize";
import { digest, type SubtitleState } from "./subtitle-storage";
import * as storage from "./subtitle-storage";

const normalize: TermNormalizer = (text) => {
  const replacements = [...text.matchAll(/ashy grami/gi)].map((match) => ({
    from: match[0], to: "ashi garami", canonical: "ashi garami", offset: match.index,
  }));
  return { text: text.replace(/ashy grami/gi, "ashi garami"), replacements };
};
const source = "1\n00:00:00,120 --> 00:00:04,321\nUse ashy grami.\n\n2\n00:00:05,000 --> 00:00:07,000\nHold position.\n";

describe("subtitle payload normalization", () => {
  it("preserves SRT numbering, timing, line endings, markup and replacement locations", () => {
    const input = "\uFEFF1\r\n00:00:00,120 --> 00:00:04,321\r\n<i>ashy grami</i>\r\nAn ashy grami entry.\r\n\r\n";
    const result = normalizeSubtitleDocument(input, normalize);
    expect(result.text).toBe(input.replaceAll("ashy grami", "ashi garami"));
    expect(subtitleStructure(result.text)).toEqual(subtitleStructure(input));
    expect(result.replacements.map(({ line, offset }) => ({ line, offset }))).toEqual([
      { line: 3, offset: input.indexOf("ashy grami") }, { line: 4, offset: input.lastIndexOf("ashy grami") },
    ]);
  });

  it("preserves WebVTT headers, cue IDs, settings, comments, styles and voice labels", () => {
    const input = ["WEBVTT ashy grami", "Kind: captions", "", "NOTE ashy grami", "ashy grami", "",
      "STYLE", "::cue(.ashy grami) { color: red; }", "", "REGION", "id:ashy grami", "",
      "ashy grami", "00:00.000 --> 00:05.000 line:90%", "<v ashy grami>Do ashy grami.</v>", "",
      "00:06.000 --> 00:10.000", "<00:07.000>Another ashy grami.", ""].join("\n");
    const result = normalizeSubtitleDocument(input, normalize);
    expect(result.text).toBe(input.replace("Do ashy grami", "Do ashi garami").replace("Another ashy grami", "Another ashi garami"));
    expect(result.replacements).toHaveLength(2);
    expect(subtitleStructure(result.text)).toEqual(subtitleStructure(input));
  });

  it("does not treat prose without a cue timing line as subtitle payload", () => {
    const input = "ashy grami\nmalformed time\nashy grami\n";
    expect(normalizeSubtitleDocument(input, normalize)).toEqual({ text: input, replacements: [] });
    expect(normalizeSubtitleDocument("", normalize)).toEqual({ text: "", replacements: [] });
  });

  it("rejects normalizers that introduce newlines", () => {
    expect(() => normalizeSubtitleDocument(source, () => ({ text: "extra\nline", replacements: [] }))).toThrow(/cannot add subtitle lines/);
  });
});

describe("audited local correction batches", () => {
  let directory: string;
  let output: string;
  let stateDirectory: string;
  let file: string;
  let stateFile: string;
  let state: SubtitleState;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "subtitle-normalize-test-"));
    output = path.join(directory, "subtitles");
    stateDirectory = path.join(directory, ".subtitles");
    file = path.join(output, "Course", "Chapter.mp4.srt");
    stateFile = path.join(stateDirectory, "state.json");
    await mkdir(path.dirname(file), { recursive: true });
    await mkdir(stateDirectory, { recursive: true });
    await writeFile(file, source);
    state = { version: 1, usage: [{ at: 1000, seconds: 60 }], cooldownUntil: 2000, videos: {
      video: { fingerprint: "source-fingerprint", output: file, complete: true, outputHash: digest(source), durationSeconds: 7 },
    } };
    await writeFile(stateFile, JSON.stringify(state));
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });

  const run = (outputDirectory: string, stateDirectory: string, apply: boolean, normalizer = normalize) =>
    correctSubtitleFiles({ outputDirectory, stateDirectory, apply, normalize: normalizer });

  it("previews every edit without changing subtitle or checkpoint bytes", async () => {
    const originalState = await readFile(stateFile, "utf8");
    const result = await run(output, stateDirectory, false);
    expect(result.report).toMatchObject({ status: "dry-run", filesScanned: 1, filesChanged: 1, replacementCount: 1, terms: { "ashi garami": 1 } });
    expect(result.report.files[0]).toMatchObject({ beforeHash: digest(source), afterHash: digest(source.replace("ashy grami", "ashi garami")), stateVideoIds: ["video"] });
    expect(await readFile(file, "utf8")).toBe(source);
    expect(await readFile(stateFile, "utf8")).toBe(originalState);
    expect(await readdir(stateDirectory)).toEqual(["state.json"]);
  });

  it("backs up exact originals, preserves timing and advances only known output hashes", async () => {
    const originalState = await readFile(stateFile, "utf8");
    const untouched = path.join(output, "already.vtt");
    await writeFile(untouched, "WEBVTT\n\n00:00.000 --> 00:01.000\nashi garami\n");
    const result = await run(output, stateDirectory, true);
    const corrected = await readFile(file, "utf8");
    expect(corrected).toBe(source.replace("ashy grami", "ashi garami"));
    expect(subtitleStructure(corrected)).toEqual(subtitleStructure(source));
    expect(await readFile(path.join(result.backupDirectory!, "files", "Course", "Chapter.mp4.srt"), "utf8")).toBe(source);
    expect(await readFile(path.join(result.backupDirectory!, "state.json"), "utf8")).toBe(originalState);
    const next = JSON.parse(await readFile(stateFile, "utf8"));
    expect(next).toEqual({ ...state, videos: { video: { ...state.videos.video, outputHash: digest(corrected) } } });
    expect(JSON.parse(await readFile(result.reportFile!, "utf8"))).toEqual(result.report);
    expect(result.report).toMatchObject({ status: "applied", filesScanned: 2, filesChanged: 1, replacementCount: 1, stateAfterHash: digest(await readFile(stateFile, "utf8")) });
    expect((await run(output, stateDirectory, false)).report.filesChanged).toBe(0);
    expect(await readdir(stateDirectory)).not.toContain("run.lock");
  });

  it("corrects untracked VTT files without inventing a generation checkpoint", async () => {
    await rm(stateFile);
    const result = await run(output, stateDirectory, true);
    expect(result.report.filesChanged).toBe(1);
    expect(result.report.stateBeforeHash).toBeNull();
    await expect(readFile(stateFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.report.files[0].stateVideoIds).toEqual([]);
  });

  it("accepts a known pending publication and retains incomplete generation status", async () => {
    state.videos.video = { ...state.videos.video, complete: false, outputHash: digest("previous output"), pendingOutputHash: digest(source) };
    await writeFile(stateFile, JSON.stringify(state));
    await run(output, stateDirectory, true);
    const next = JSON.parse(await readFile(stateFile, "utf8"));
    expect(next.videos.video).toMatchObject({ complete: false, outputHash: digest(source.replace("ashy grami", "ashi garami")) });
    expect(next.videos.video.pendingOutputHash).toBeUndefined();
  });

  it("retains both accepted hashes if interrupted before replacing an earlier pending output", async () => {
    state.videos.video = { ...state.videos.video, complete: false, outputHash: digest("previous output"), pendingOutputHash: digest(source) };
    await writeFile(stateFile, JSON.stringify(state));
    const atomicWrite = storage.atomicWrite;
    vi.spyOn(storage, "atomicWrite").mockImplementation(async (target, content) => {
      if (target === file) throw new Error("simulated interrupted publication");
      return atomicWrite(target, content);
    });
    await expect(run(output, stateDirectory, true)).rejects.toThrow(/simulated interrupted publication/);
    const interrupted = JSON.parse(await readFile(stateFile, "utf8"));
    expect(interrupted.videos.video).toMatchObject({
      complete: false, outputHash: digest(source), pendingOutputHash: digest(source.replace("ashy grami", "ashi garami")),
    });
    expect(await readFile(file, "utf8")).toBe(source);
    vi.restoreAllMocks();
    expect((await run(output, stateDirectory, true)).report.status).toBe("applied");
  });

  it("refuses unknown edits before writing any subtitles, backups or state", async () => {
    await writeFile(file, `${source}\nAn outside edit.`);
    const originalState = await readFile(stateFile, "utf8");
    await expect(run(output, stateDirectory, true)).rejects.toThrow(/does not match its checkpoint/);
    expect(await readFile(file, "utf8")).toBe(`${source}\nAn outside edit.`);
    expect(await readFile(stateFile, "utf8")).toBe(originalState);
    expect(await readdir(stateDirectory)).toEqual(["state.json"]);
  });

  it("respects the shared generation lock and does not remove another job's lock", async () => {
    await writeFile(path.join(stateDirectory, "run.lock"), "another process");
    await expect(run(output, stateDirectory, true)).rejects.toThrow(/job lock exists/);
    expect(await readFile(path.join(stateDirectory, "run.lock"), "utf8")).toBe("another process");
    expect(await readFile(file, "utf8")).toBe(source);
  });

  it("refuses symlinks and invalid UTF-8 instead of rewriting unexpected files", async () => {
    const link = path.join(output, "linked.srt");
    await symlink(file, link);
    await expect(run(output, stateDirectory, true)).rejects.toThrow(/symbolic link/);
    await rm(link);
    await writeFile(file, Buffer.from([0xff, 0xfe]));
    await expect(run(output, stateDirectory, true)).rejects.toThrow(/not valid UTF-8/);
    expect(await readFile(file)).toEqual(Buffer.from([0xff, 0xfe]));
  });
});
