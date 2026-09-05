import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, atomicWrite, digest, fingerprint, loadState, outputPaths, readJson, safeComponent, saveState, type SubtitleState } from "./subtitle-storage";
import type { DriveVideo } from "./subtitle-drive";

let directory: string;
const identity = { provider: "deepgram", model: "nova-3" };
const emptyState: SubtitleState = { version: 1, usage: [], cooldownUntil: 0, videos: {} };
const video = (id: string, name: string, folders = ["Instructional"]): DriveVideo => ({
  id, name, path: [...folders, name], durationSeconds: 600, sizeBytes: 100_000,
  modifiedTime: "2026-09-05T00:00:00Z",
});

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "subtitle-storage-test-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("outputPaths", () => {
  it("preserves the hierarchy, full video filename, and deterministic collision choices", () => {
    const videos = [video("a", "Volume 1.mp4"), video("b", "volume 1.mp4"), video("c", "Volume 1.mp4", ["Another set"])];
    const outputs = outputPaths(videos, directory);
    expect(outputs.size).toBe(3);
    expect(new Set([...outputs.values()].map((output) => output.toLowerCase())).size).toBe(3);
    expect(outputs.get("c")).toBe(path.join(directory, "Another set", "Volume 1.mp4.srt"));
    expect(Object.fromEntries(outputPaths([...videos].reverse(), directory))).toEqual(Object.fromEntries(outputs));
  });

  it("resolves Unicode-normalized collisions and collisions with generated suffixes", () => {
    const firstId = "duplicate-a";
    const videos = [
      video(firstId, "Clip.mp4"), video("duplicate-b", "Clip.mp4"),
      video("suffix-video", `Clip.mp4--${digest(firstId).slice(0, 16)}`),
      video("unicode-a", "Caf\u00e9.mp4"), video("unicode-b", "Cafe\u0301.mp4"),
    ];
    const outputs = outputPaths(videos, directory);
    const canonical = [...outputs.values()].map((output) => output.normalize("NFC").toLowerCase());
    expect(new Set(canonical).size).toBe(videos.length);
    expect(Object.fromEntries(outputPaths([...videos].reverse(), directory))).toEqual(Object.fromEntries(outputs));
  });

  it("encodes traversal and separators rather than escaping the output directory", () => {
    const output = outputPaths([video("tricky", "../../escape\\video.mp4", ["..", "/absolute", "\u0000folder"])], directory).get("tricky")!;
    expect(path.relative(directory, output).startsWith("..")).toBe(false);
    expect(output).toContain("%2f");
    expect(output).toContain("%5c");
    expect(output).not.toContain("\u0000");
    expect(new Set(["", ".", "..", "%2e", "/", "%2f"].map(safeComponent)).size).toBe(6);
  });

  it("shortens long UTF-8 names with stable unique suffixes", () => {
    const first = safeComponent("\u00e9".repeat(200));
    const second = safeComponent(`${"\u00e9".repeat(200)}x`);
    expect(Buffer.byteLength(first)).toBeLessThanOrEqual(180);
    expect(first).toBe(safeComponent("\u00e9".repeat(200)));
    expect(second).not.toBe(first);
  });
});

describe("checkpoint storage", () => {
  it("initializes a missing checkpoint and atomically preserves existing usage", async () => {
    const file = path.join(directory, "nested", "state.json");
    await expect(loadState(file)).resolves.toEqual(emptyState);
    const saved = { ...emptyState, usage: [{ at: 1000, seconds: 600 }], cooldownUntil: 5000 };
    await atomicWrite(file, JSON.stringify(saved));
    await expect(loadState(file)).resolves.toEqual(saved);
    await atomicWrite(file, JSON.stringify({ ...saved, cooldownUntil: 6000 }));
    await expect(readJson(file)).resolves.toEqual({ ...saved, cooldownUntil: 6000 });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(path.dirname(file))).toEqual(["state.json"]);
  });

  it("serializes overlapping shared-state writes without losing concurrent attempts", async () => {
    const file = path.join(directory, "state.json");
    const state: SubtitleState = { ...emptyState, usage: [], videos: {} };
    const writes: Promise<void>[] = [];
    for (let index = 0; index < 25; index += 1) {
      state.usage.push({ at: index, seconds: 600 });
      writes.push(saveState(file, state));
    }
    await Promise.all(writes);
    expect((await loadState(file)).usage).toEqual(state.usage);
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses corrupt JSON instead of resetting request history", async () => {
    const file = path.join(directory, "state.json");
    await writeFile(file, '{"usage":');
    await expect(loadState(file)).rejects.toThrow(/checkpoint/);
    expect(await readFile(file, "utf8")).toBe('{"usage":');
  });

  it.each([
    null, false, 0, [],
    { ...emptyState, version: 2 },
    { ...emptyState, usage: [{ at: -1, seconds: 600 }] },
    { ...emptyState, usage: [{ at: 0, seconds: 0 }] },
    { ...emptyState, usage: [{ at: 0, seconds: "600" }] },
    { ...emptyState, usage: [null] },
    { ...emptyState, cooldownUntil: -1 },
    { ...emptyState, videos: [] },
  ])("rejects malformed saved state %#", async (value) => {
    const file = path.join(directory, "state.json");
    await writeFile(file, JSON.stringify(value));
    await expect(loadState(file)).rejects.toThrow(/state|checkpoint/i);
  });

  it("changes the source fingerprint when a source or transcription setting changes", () => {
    const source = video("source", "Clip.mp4");
    const original = fingerprint(source, 600, "en", identity);
    expect(fingerprint({ ...source, name: "Renamed.mp4" }, 600, "en", identity)).toBe(original);
    expect(fingerprint({ ...source, modifiedTime: "2026-09-06T00:00:00Z" }, 600, "en", identity)).not.toBe(original);
    expect(fingerprint({ ...source, sizeBytes: 100_001 }, 600, "en", identity)).not.toBe(original);
    expect(fingerprint(source, 300, "en", identity)).not.toBe(original);
    expect(fingerprint(source, 600, "auto", identity)).not.toBe(original);
    expect(fingerprint(source, 600, "en", { ...identity, model: "other-model" })).not.toBe(original);
  });
});

describe("job lock", () => {
  it("refuses a concurrent writer and permits resume only after releasing the lock", async () => {
    const file = path.join(directory, "run.lock");
    const release = await acquireLock(file);
    const original = await readFile(file, "utf8");
    expect(JSON.parse(original).pid).toBe(process.pid);
    await expect(acquireLock(file)).rejects.toThrow(/lock exists/);
    expect(await readFile(file, "utf8")).toBe(original);
    await release();
    const releaseResumed = await acquireLock(file);
    await releaseResumed();
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
