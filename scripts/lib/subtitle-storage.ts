import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { DriveVideo } from "./subtitle-drive";
import type { Transcriber, Usage } from "./subtitle-core";

export type VideoProgress = {
  fingerprint: string;
  output: string;
  durationSeconds?: number;
  complete?: boolean;
  outputHash?: string;
  pendingOutputHash?: string;
  error?: string;
};

export type SubtitleState = {
  version: 1;
  usage: Usage[];
  cooldownUntil: number;
  videos: Record<string, VideoProgress>;
};

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Cannot read ${file}; preserve and repair this checkpoint before resuming.`, { cause: error });
  }
}

export async function atomicWrite(file: string, value: string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function fingerprint(video: DriveVideo, chunkSeconds: number, language: string, identity: Transcriber["identity"]) {
  return digest(JSON.stringify({
    version: 3, provider: identity.provider, model: identity.model, id: video.id,
    modifiedTime: video.modifiedTime, sizeBytes: video.sizeBytes,
    chunkSeconds, language, audio: "flac/16000/mono/s16",
  }));
}

const stateWrites = new Map<string, Promise<void>>();

/** Serialize shared-state snapshots so concurrent completions cannot overwrite
 * newer progress. Serialize the live object only when this write reaches the head. */
export function saveState(file: string, state: SubtitleState): Promise<void> {
  const key = path.resolve(file);
  const previous = stateWrites.get(key) ?? Promise.resolve();
  const write = previous.catch(() => {}).then(() => atomicWrite(key, JSON.stringify(state, null, 2)));
  stateWrites.set(key, write);
  const clear = () => { if (stateWrites.get(key) === write) stateWrites.delete(key); };
  void write.then(clear, clear);
  return write;
}

// Encode path separators, control characters, dot paths and percent signs without
// flattening the Drive hierarchy. Hash shortened components for stable uniqueness.
export function safeComponent(name: string) {
  const safe = [...name].map((character) =>
    "%/\\".includes(character) || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ? `%${character.charCodeAt(0).toString(16).padStart(2, "0")}` : character).join("");
  if (!safe || safe === "." || safe === "..") return `%${Buffer.from(name || "empty").toString("hex")}`;
  if (Buffer.byteLength(safe) <= 180) return safe;
  let shortened = safe;
  while (Buffer.byteLength(shortened) > 150) shortened = shortened.slice(0, -1);
  return `${shortened}--${digest(name).slice(0, 16)}`;
}

export function outputPaths(videos: DriveVideo[], directory: string): Map<string, string> {
  const candidates = videos.map((video) => ({
    id: video.id,
    output: path.join(directory, ...video.path.slice(0, -1).map(safeComponent), `${safeComponent(video.name)}.srt`),
  }));
  const counts = new Map<string, number>();
  for (const { output } of candidates) {
    const key = output.normalize("NFC").toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const key = (value: string) => value.normalize("NFC").toLowerCase();
  const occupied = new Set(candidates.map(({ output }) => key(output)));
  return new Map(candidates.map(({ id, output }) => {
    if (counts.get(key(output)) === 1) return [id, output];
    let candidate = `${output.slice(0, -4)}--${digest(id).slice(0, 16)}.srt`;
    let attempt = 0;
    while (occupied.has(key(candidate))) {
      candidate = `${output.slice(0, -4)}--${digest(id).slice(0, 16)}-${++attempt}.srt`;
    }
    occupied.add(key(candidate));
    return [id, candidate];
  }));
}

export async function loadState(file: string): Promise<SubtitleState> {
  const state = await readJson<SubtitleState>(file);
  if (state === undefined) return { version: 1, usage: [], cooldownUntil: 0, videos: {} };
  if (!state || state.version !== 1 || !Array.isArray(state.usage) ||
      !Number.isFinite(state.cooldownUntil) || state.cooldownUntil < 0 || !state.videos ||
      typeof state.videos !== "object" || Array.isArray(state.videos) ||
      state.usage.some((use) => !use || !Number.isFinite(use.at) || use.at < 0 || !Number.isFinite(use.seconds) || use.seconds <= 0)) {
    throw new Error(`Invalid state in ${file}; do not discard quota history to resume.`);
  }
  return state;
}

/** Exclusive process lock shared across output directories and quota settings. */
export async function acquireLock(file: string) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`A subtitle job lock exists at ${file}. If its process has stopped, remove only that lock and rerun. Keep state.json.`);
    }
    throw error;
  }
  return () => rm(file, { force: true });
}
