import { normalizeJapaneseTerms } from "./subtitle-terminology";

/** Provider-independent chunk planning, checkpoints, and SRT formatting. */
export type Usage = { at: number; seconds: number };
export type Chunk = { index: number; start: number; duration: number };
export type Segment = { start: number; end: number; text: string };
export type Transcriber = {
  readonly identity: { readonly provider: string; readonly model: string };
  transcribe(file: string, seconds: number, language: string, prompt: string): Promise<Segment[]>;
};

function finiteNumber(value: unknown, label: string, minimum = 0): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${label} must be a finite number greater than or equal to ${minimum}.`);
  }
}

function positiveNumber(value: unknown, label: string): asserts value is number {
  finiteNumber(value, label);
  if (value === 0) throw new Error(`${label} must be greater than zero.`);
}

/** Split real playback seconds into consecutive, non-overlapping requests. */
export function planChunks(duration: number, chunkSeconds: number): Chunk[] {
  positiveNumber(duration, "Video duration");
  positiveNumber(chunkSeconds, "Chunk duration");
  const count = Math.ceil(duration / chunkSeconds);
  if (!Number.isSafeInteger(count) || count > 1_000_000) {
    throw new Error("Video requires too many chunks; increase the chunk duration.");
  }
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * chunkSeconds,
    duration: Math.min(chunkSeconds, duration - index * chunkSeconds),
  })).filter((chunk) => chunk.duration > 0);
}

export function parseTranscript(value: unknown): Segment[] {
  const result = value as { text?: unknown; segments?: unknown } | null;
  if (!result || !Array.isArray(result.segments)) throw new Error("Transcription provider returned no timestamped segments.");
  const segments = result.segments.map((value: unknown) => {
    const segment = value as Segment | null;
    if (!segment || typeof segment.text !== "string" ||
        typeof segment.start !== "number" || !Number.isFinite(segment.start) ||
        typeof segment.end !== "number" || !Number.isFinite(segment.end) ||
        segment.end < segment.start) throw new Error("Transcription provider returned an invalid timestamped segment.");
    return { start: segment.start, end: segment.end, text: segment.text };
  });
  if (!segments.some((segment) => segment.text.trim()) && typeof result.text === "string" && result.text.trim()) {
    throw new Error("Transcription provider returned speech text without usable timestamped segments.");
  }
  return segments;
}

function timestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor(milliseconds / 60_000) % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;
  const remainder = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(remainder).padStart(3, "0")}`;
}

/** Offset chunk-local segments, clamp them to real audio, and serialize valid SRT. */
export function renderSrt(chunks: { start: number; duration: number; segments: Segment[] }[]): string {
  if (!Array.isArray(chunks)) throw new Error("Transcribed chunks must be an array.");
  const cues: { start: number; end: number; text: string }[] = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (!chunk || typeof chunk !== "object") throw new Error(`Invalid chunk ${chunkIndex}.`);
    finiteNumber(chunk.start, `Chunk ${chunkIndex} start`);
    positiveNumber(chunk.duration, `Chunk ${chunkIndex} duration`);
    if (!Number.isSafeInteger(Math.round((chunk.start + chunk.duration) * 1000))) {
      throw new Error(`Chunk ${chunkIndex} ends outside the supported timestamp range.`);
    }
    if (!Array.isArray(chunk.segments)) throw new Error(`Chunk ${chunkIndex} segments must be an array.`);
    for (const [segmentIndex, segment] of chunk.segments.entries()) {
      const label = `Chunk ${chunkIndex} segment ${segmentIndex}`;
      if (!segment || typeof segment !== "object") throw new Error(`${label} must be an object.`);
      finiteNumber(segment.start, `${label} start`, -Infinity);
      finiteNumber(segment.end, `${label} end`, -Infinity);
      if (segment.end < segment.start) throw new Error(`${label} ends before it starts.`);
      if (typeof segment.text !== "string") throw new Error(`${label} text must be a string.`);
      const text = normalizeJapaneseTerms(segment.text.replace(/\s+/gu, " ").trim()).text;
      const start = Math.round((chunk.start + Math.max(0, Math.min(chunk.duration, segment.start))) * 1000);
      const end = Math.round((chunk.start + Math.max(0, Math.min(chunk.duration, segment.end))) * 1000);
      if (text && end > start) cues.push({ start, end, text });
    }
  }
  cues.sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  const output: string[] = [];
  for (const cue of cues) {
    const start = Math.max(previousEnd, cue.start);
    if (cue.end <= start) continue;
    output.push(`${output.length + 1}\n${timestamp(start)} --> ${timestamp(cue.end)}\n${cue.text}`);
    previousEnd = cue.end;
  }
  return output.length ? `${output.join("\n\n")}\n` : "";
}
