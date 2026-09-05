import { CaptionFormatError } from "./captions";

export type CaptionCue = { startSeconds: number; endSeconds: number; text: string };
export type PreparedCaptions = {
  cues: CaptionCue[];
  content: string;
  cueCount: number;
  lastCueEndSeconds: number | null;
};

type RawCue = { start: number; end: number; text: string; lines: string[] };

function milliseconds(value: string): number {
  const match = /^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)[.,](\d{1,3})$/.exec(value);
  if (!match) throw new CaptionFormatError(`Invalid caption timestamp: ${value}`);
  const result = Number(match[1] ?? 0) * 3_600_000 + Number(match[2]) * 60_000 + Number(match[3]) * 1000 + Number(match[4].padEnd(3, "0"));
  if (!Number.isSafeInteger(result)) throw new CaptionFormatError("Caption timestamp is outside the supported range");
  return result;
}

function plainText(value: string): string {
  return value
    .replace(/<\d{2,}(?::\d{2})?:\d{2}\.\d{3}>/g, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\{\\an[1-9]\}/g, "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|nbsp|quot|apos|lrm|rlm);/gi, (entity, body: string) => {
      const names: Record<string, string> = { amp: "&", lt: "<", gt: ">", nbsp: " ", quot: '"', apos: "'", lrm: "", rlm: "" };
      if (!body.startsWith("#")) return names[body.toLowerCase()];
      const point = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : entity;
    })
    .replace(/\s+/g, " ").trim();
}

function parse(content: string): RawCue[] {
  if (typeof content !== "string") throw new CaptionFormatError("Caption content must be text");
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  const blocks = text.split(/\n[ \t]*\n+/);
  const vtt = /^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text);
  if (vtt) {
    const header = blocks.shift()!;
    if (header.includes("-->")) throw new CaptionFormatError("Separate the WebVTT header and cues with a blank line");
  }
  const cues: RawCue[] = [];
  for (const block of blocks) {
    if (vtt && /^(?:NOTE(?:[ \t]|$)|STYLE(?:\n|$)|REGION(?:\n|$))/.test(block)) continue;
    const lines = block.split("\n");
    let timingIndex = 0;
    if (!lines[0]?.includes("-->")) timingIndex = 1;
    const timing = /^(\S+)\s+-->\s+(\S+)(.*)$/.exec(lines[timingIndex] ?? "");
    if (!timing || (!vtt && timingIndex === 1 && !/^\d+$/.test(lines[0]))) {
      throw new CaptionFormatError("Invalid caption cue: expected SRT or WebVTT timestamps");
    }
    if (timing[3].trim() && (!vtt || !/^(?:\s+(?:vertical|line|position|size|align|region):\S+)+$/.test(timing[3]))) {
      throw new CaptionFormatError("Invalid caption cue settings");
    }
    const start = milliseconds(timing[1]);
    const end = milliseconds(timing[2]);
    if (end <= start) throw new CaptionFormatError("Caption cues must end after they start");
    const payload = lines.slice(timingIndex + 1);
    if (payload.some((line) => line.includes("-->"))) throw new CaptionFormatError("Separate caption cues with a blank line");
    const cleanLines = payload.map(plainText).filter(Boolean);
    const cueText = cleanLines.join(" ");
    if (!cueText) throw new CaptionFormatError("Caption cues must contain text");
    cues.push({ start, end, text: cueText, lines: cleanLines });
  }
  if (!cues.length) throw new CaptionFormatError("No caption cues found in this file");
  return cues.sort((left, right) => left.start - right.start);
}

/** Remove only recognisable rolling updates while cues are simultaneously active.
 * Unrelated overlaps retain every word, including natural spoken repetition. */
function freshText(previous: RawCue, current: RawCue): string {
  if (previous.end <= current.start) return current.text;
  const before = previous.text.split(" ");
  const after = current.text.split(" ");
  const repeatedLine = previous.lines.length > 1 && current.lines.length > 1 && previous.lines.at(-1) === current.lines[0];
  for (let count = Math.min(before.length, after.length); count >= 1; count -= 1) {
    const exactCue = count === before.length && count === after.length;
    if (!exactCue && (count < 2 || (count !== before.length && count !== after.length && !repeatedLine))) continue;
    if (before.slice(-count).join(" ") === after.slice(0, count).join(" ")) return after.slice(count).join(" ");
  }
  return current.text;
}

function timestamp(ms: number): string {
  return `${String(Math.floor(ms / 3_600_000)).padStart(2, "0")}:${String(Math.floor(ms / 60_000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/** Accept SRT or WebVTT and emit a single plain, chronologically ordered track. */
export function prepareCaptions(content: string): PreparedCaptions {
  const raw = parse(content);
  const normalized: { start: number; end: number; text: string }[] = [];
  let previous: RawCue | undefined;
  for (const current of raw) {
    const text = previous ? freshText(previous, current) : current.text;
    previous = current;
    const last = normalized.at(-1);
    if (!text && last) {
      last.end = Math.max(last.end, current.end);
      continue;
    }
    if (last && last.start === current.start) {
      last.text = `${last.text} ${text}`;
      last.end = Math.max(last.end, current.end);
      continue;
    }
    const end = Math.max(current.end, last?.end ?? 0);
    if (last && last.end > current.start) last.end = current.start;
    normalized.push({ start: current.start, end, text });
  }
  const cues = normalized.map((cue) => ({ startSeconds: cue.start / 1000, endSeconds: cue.end / 1000, text: cue.text }));
  const blocks = normalized.map((cue, index) => `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`);
  return { cues, content: `WEBVTT\n\n${blocks.join("\n\n")}\n`, cueCount: cues.length, lastCueEndSeconds: cues.at(-1)?.endSeconds ?? null };
}
