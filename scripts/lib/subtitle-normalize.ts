import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { acquireLock, atomicWrite, digest, loadState, type SubtitleState, type VideoProgress } from "./subtitle-storage";

export type TermReplacement = { from: string; to: string; canonical: string; offset: number };
export type TermNormalizer = (text: string) => { text: string; replacements: TermReplacement[] };
export type SubtitleReplacement = TermReplacement & { line: number };

const TIMING = /^\s*(?:\d+:)?\d{2}:\d{2}[.,]\d{3}\s+-->\s+(?:\d+:)?\d{2}:\d{2}[.,]\d{3}(?:\s.*)?$/;

/** Identify cue payload lines without changing newline style, IDs, settings or metadata. */
function subtitleLines(content: string) {
  const parts = content.split(/(\r\n|\n|\r)/);
  let payload = false;
  let metadata = false;
  let blockStart = true;
  let offset = 0;
  return Array.from({ length: Math.ceil(parts.length / 2) }, (_, index) => {
    const text = parts[index * 2];
    const ending = parts[index * 2 + 1] ?? "";
    const clean = text.replace(/^\uFEFF/, "");
    const blank = !clean.trim();
    if (blockStart && /^(?:WEBVTT(?:\s|$)|NOTE(?:\s|$)|STYLE\s*$|REGION\s*$)/.test(clean)) metadata = true;
    const timing = !metadata && TIMING.test(clean);
    const isPayload = !blank && payload && !metadata;
    if (blank) { payload = false; metadata = false; blockStart = true; }
    else { if (timing) payload = true; blockStart = false; }
    const line = { text, ending, offset, number: index + 1, isPayload: isPayload && !timing };
    offset += text.length + ending.length;
    return line;
  });
}

/** Every non-payload byte, plus payload line boundaries, must survive an edit. */
export function subtitleStructure(content: string) {
  return subtitleLines(content).map((line) => [line.isPayload ? null : line.text, line.ending]);
}

export function normalizeSubtitleDocument(content: string, normalize: TermNormalizer) {
  const replacements: SubtitleReplacement[] = [];
  const text = subtitleLines(content).map((line) => {
    if (!line.isPayload) return line.text + line.ending;
    // Preserve markup, voice labels and inline timestamp tags as written.
    let offset = 0;
    const value = line.text.split(/(<[^>]*>)/).map((part) => {
      const start = offset;
      offset += part.length;
      if (part.startsWith("<") && part.endsWith(">")) return part;
      const result = normalize(part);
      if (/[\r\n]/.test(result.text)) throw new Error("Terminology normalization cannot add subtitle lines.");
      replacements.push(...result.replacements.map((replacement) => ({
        ...replacement, offset: line.offset + start + replacement.offset, line: line.number,
      })));
      return result.text;
    }).join("");
    return value + line.ending;
  }).join("");
  if (JSON.stringify(subtitleStructure(content)) !== JSON.stringify(subtitleStructure(text))) {
    throw new Error("Terminology normalization changed subtitle structure.");
  }
  return { text, replacements };
}

export type CorrectionFile = {
  file: string;
  beforeHash: string;
  afterHash: string;
  replacements: SubtitleReplacement[];
  stateVideoIds: string[];
};
export type CorrectionReport = {
  version: 1;
  createdAt: string;
  status: "dry-run" | "prepared" | "applied" | "failed";
  outputDirectory: string;
  stateFile: string;
  stateBeforeHash: string | null;
  stateAfterHash?: string;
  filesScanned: number;
  filesChanged: number;
  replacementCount: number;
  terms: Record<string, number>;
  files: CorrectionFile[];
  error?: string;
};

async function readUtf8(file: string) {
  if ((await lstat(file)).isSymbolicLink()) throw new Error(`Refusing a symbolic link: ${file}`);
  const bytes = await readFile(file);
  const content = bytes.toString("utf8");
  if (!Buffer.from(content, "utf8").equals(bytes)) throw new Error(`Subtitle is not valid UTF-8: ${file}`);
  return content;
}

async function optionalUtf8(file: string) {
  try { return await readUtf8(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

async function subtitleFiles(directory: string): Promise<string[]> {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error(`Refusing a symbolic link directory: ${directory}`);
  const result: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symbolic link: ${file}`);
    if (entry.isDirectory()) result.push(...await subtitleFiles(file));
    else if (entry.isFile() && /\.(?:srt|vtt)$/i.test(entry.name)) result.push(file);
  }
  return result;
}

async function assertUnchanged(file: string, expected: string | undefined) {
  const current = await optionalUtf8(file);
  if ((current === undefined ? undefined : digest(current)) !== expected) {
    throw new Error(`File changed during the terminology scan; no further files will be written: ${file}`);
  }
}

/** Local-only, reviewed correction batch. Does not access environment files or remote services. */
export async function correctSubtitleFiles(options: {
  outputDirectory: string;
  stateDirectory: string;
  apply: boolean;
  normalize: TermNormalizer;
}) {
  const outputDirectory = path.resolve(options.outputDirectory);
  const stateDirectory = path.resolve(options.stateDirectory);
  const stateFile = path.join(stateDirectory, "state.json");
  const release = await acquireLock(path.join(stateDirectory, "run.lock"));
  try {
    const stateOriginal = await optionalUtf8(stateFile);
    const state: SubtitleState = await loadState(stateFile);
    await assertUnchanged(stateFile, stateOriginal === undefined ? undefined : digest(stateOriginal));
    const byOutput = new Map<string, [string, VideoProgress][]>();
    for (const [id, progress] of Object.entries(state.videos)) {
      if (!progress || typeof progress.output !== "string") throw new Error(`Invalid video checkpoint: ${id}`);
      const file = path.resolve(progress.output);
      byOutput.set(file, [...byOutput.get(file) ?? [], [id, progress]]);
    }

    const files = [];
    for (const file of await subtitleFiles(outputDirectory)) {
      const original = await readUtf8(file);
      const beforeHash = digest(original);
      const normalized = normalizeSubtitleDocument(original, options.normalize);
      const records = byOutput.get(file) ?? [];
      // The checkpoint is an ownership check, not a value to rewrite around unknown edits.
      if (records.some(([, record]) => beforeHash !== record.outputHash && beforeHash !== record.pendingOutputHash)) {
        throw new Error(`Refusing an edited subtitle whose hash does not match its checkpoint: ${file}`);
      }
      files.push({ file, original, normalized: normalized.text, records, report: {
        file: path.relative(outputDirectory, file), beforeHash, afterHash: digest(normalized.text),
        replacements: normalized.replacements, stateVideoIds: records.map(([id]) => id),
      } satisfies CorrectionFile });
    }
    const changed = files.filter((file) => file.report.beforeHash !== file.report.afterHash);
    const report: CorrectionReport = {
      version: 1, createdAt: new Date().toISOString(), status: options.apply ? "prepared" : "dry-run",
      outputDirectory, stateFile, stateBeforeHash: stateOriginal === undefined ? null : digest(stateOriginal),
      filesScanned: files.length, filesChanged: changed.length,
      replacementCount: files.reduce((count, file) => count + file.report.replacements.length, 0),
      terms: {}, files: files.map((file) => file.report),
    };
    for (const file of report.files) {
      for (const replacement of file.replacements) report.terms[replacement.canonical] = (report.terms[replacement.canonical] ?? 0) + 1;
    }
    if (!options.apply) return { report, reportFile: undefined, backupDirectory: undefined };
    if (!changed.length) { report.status = "applied"; return { report, reportFile: undefined, backupDirectory: undefined }; }

    // Validate the entire batch before creating backups or staging checkpoint changes.
    for (const file of files) await assertUnchanged(file.file, file.report.beforeHash);
    let stateHash = report.stateBeforeHash ?? undefined;
    await assertUnchanged(stateFile, stateHash);
    const backupDirectory = path.join(stateDirectory, "terminology-backups", `${report.createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
    await mkdir(backupDirectory, { recursive: true });
    const reportFile = path.join(backupDirectory, "report.json");
    for (const file of changed) await atomicWrite(path.join(backupDirectory, "files", file.report.file), file.original);
    if (stateOriginal !== undefined) await atomicWrite(path.join(backupDirectory, "state.json"), stateOriginal);
    await atomicWrite(reportFile, JSON.stringify(report, null, 2));
    const completion = new Map<VideoProgress, boolean | undefined>();
    const writeState = async () => {
      await assertUnchanged(stateFile, stateHash);
      const content = JSON.stringify(state, null, 2);
      await atomicWrite(stateFile, content);
      stateHash = digest(content);
    };
    const tracked = changed.some((file) => file.records.length);
    try {
      for (const file of changed) {
        for (const [, record] of file.records) {
          completion.set(record, record.complete);
          // If the input is an earlier pending publication, retain that accepted
          // hash before replacing pendingOutputHash with this batch's new value.
          record.outputHash = file.report.beforeHash;
          record.pendingOutputHash = file.report.afterHash;
          // A process interrupted after publication must enter normal hash recovery.
          record.complete = false;
        }
      }
      if (tracked) await writeState();
      for (const file of changed) {
        await assertUnchanged(file.file, file.report.beforeHash);
        await atomicWrite(file.file, file.normalized);
        const verified = await readUtf8(file.file);
        if (digest(verified) !== file.report.afterHash ||
            JSON.stringify(subtitleStructure(verified)) !== JSON.stringify(subtitleStructure(file.original))) {
          throw new Error(`Subtitle verification failed: ${file.file}`);
        }
      }
      for (const file of changed) {
        await assertUnchanged(file.file, file.report.afterHash);
        for (const [, record] of file.records) {
          record.outputHash = file.report.afterHash;
          delete record.pendingOutputHash;
          if (completion.get(record) === undefined) delete record.complete;
          else record.complete = completion.get(record);
        }
      }
      if (tracked) await writeState();
      report.status = "applied";
      report.stateAfterHash = stateHash;
      await atomicWrite(reportFile, JSON.stringify(report, null, 2));
      return { report, reportFile, backupDirectory };
    } catch (error) {
      report.status = "failed";
      report.error = error instanceof Error ? error.message : String(error);
      await atomicWrite(reportFile, JSON.stringify(report, null, 2));
      throw new Error(`Terminology correction stopped. Originals and the audit are in ${backupDirectory}. ${report.error}`, { cause: error });
    }
  } finally { await release(); }
}
