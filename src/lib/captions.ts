/**
 * Matching uploaded WebVTT files to library videos.
 *
 * Drive names a downloaded caption track after its video, so the filename is
 * the only link back — and it is not a reliable key on its own: several
 * instructionals contain a "Volume 1 - Overview.mp4", so a name can point at
 * more than one video. Anything ambiguous is handed back for a human to
 * resolve rather than guessed at.
 */

export type CaptionCandidate = {
  id: string;
  name: string;
  path: string[];
  durationSeconds?: number | null;
};

export type CaptionMatch =
  | {
      status: "matched";
      videoId: string;
      confidence: "exact" | "fuzzy" | "duration";
      candidates: CaptionCandidate[];
    }
  | { status: "ambiguous"; candidates: CaptionCandidate[] }
  | { status: "unmatched"; candidates: CaptionCandidate[] };

const VIDEO_EXTENSIONS = /\.(mp4|mkv|mov|m4v|avi|webm)$/i;
const CAPTION_EXTENSIONS = /\.(vtt|srt)$/i;

// Drive appends a track description when more than one track exists.
const TRACK_SUFFIX = /[\s_-]*\(?(auto[-\s]?generated|english(\s*\(detected\))?)\)?$/i;

// A track downloaded from Drive is named `<video>-<lang>-asr.vtt` — the marker
// lands *after* the video extension, so it has to come off first.
const ASR_SUFFIX = /[\s._-]+([a-z]{2,3}(-[a-z]{2,4})?[\s._-]+)?asr$/i;

/**
 * Reduces a video or caption filename to a comparable key: extensions and
 * track descriptions removed, separators flattened, case and punctuation
 * dropped. `Volume.1_-_Overview.mp4.vtt` and `Volume 1 - Overview.mp4` both
 * become `volume 1 overview`.
 */
export function normalizeCaptionName(fileName: string) {
  let name = fileName.replace(/^.*[\\/]/, "");
  name = name.replace(CAPTION_EXTENSIONS, "");
  name = name.replace(ASR_SUFFIX, "");
  name = name.replace(VIDEO_EXTENSIONS, "");
  name = name.replace(TRACK_SUFFIX, "");
  return name
    .replace(/[._\-–—]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * A caption track ends when its video does, so runtime separates videos that
 * share a name. Only decisive when one candidate lands close and the rest are
 * nowhere near — a near-tie stays ambiguous rather than becoming a coin flip.
 */
const DURATION_MATCH_SECONDS = 90;
const DURATION_MARGIN_SECONDS = 120;

function disambiguateByDuration(candidates: CaptionCandidate[], lastCueEndSeconds: number | null) {
  if (lastCueEndSeconds == null) return null;

  const scored = candidates
    .filter((candidate) => candidate.durationSeconds != null)
    .map((candidate) => ({
      candidate,
      gap: Math.abs((candidate.durationSeconds as number) - lastCueEndSeconds),
    }))
    .sort((a, b) => a.gap - b.gap);

  // Every candidate must be measurable, or the unmeasured one could be the
  // real answer.
  if (scored.length !== candidates.length || scored.length < 2) return null;
  if (scored[0].gap > DURATION_MATCH_SECONDS) return null;
  if (scored[1].gap - scored[0].gap < DURATION_MARGIN_SECONDS) return null;
  return scored[0].candidate;
}

export function matchCaptionFile(
  fileName: string,
  videos: CaptionCandidate[],
  lastCueEndSeconds: number | null = null,
): CaptionMatch {
  const key = normalizeCaptionName(fileName);
  if (!key) return { candidates: [], status: "unmatched" };

  const exact = videos.filter((video) => normalizeCaptionName(video.name) === key);
  if (exact.length === 1) {
    return { candidates: exact, confidence: "exact", status: "matched", videoId: exact[0].id };
  }
  if (exact.length > 1) {
    const byDuration = disambiguateByDuration(exact, lastCueEndSeconds);
    if (byDuration) {
      return { candidates: exact, confidence: "duration", status: "matched", videoId: byDuration.id };
    }
    return { candidates: exact, status: "ambiguous" };
  }

  // No exact key. A caption file may carry extra decoration the rules above
  // don't know about, so fall back to containment — but only when it singles
  // out one video, and never as a silent "close enough".
  const partial = videos.filter((video) => {
    const candidate = normalizeCaptionName(video.name);
    return candidate.length > 3 && (candidate.includes(key) || key.includes(candidate));
  });
  if (partial.length === 1) {
    return { candidates: partial, confidence: "fuzzy", status: "matched", videoId: partial[0].id };
  }
  if (partial.length > 1) {
    const byDuration = disambiguateByDuration(partial, lastCueEndSeconds);
    if (byDuration) {
      return { candidates: partial, confidence: "duration", status: "matched", videoId: byDuration.id };
    }
    return { candidates: partial, status: "ambiguous" };
  }

  return { candidates: [], status: "unmatched" };
}

export type ParsedVtt = {
  cueCount: number;
  lastCueEndSeconds: number | null;
};

const CUE_TIMING =
  /^\s*(?:(\d+):)?([0-5]?\d):([0-5]?\d[.,]\d{1,3})\s*-->\s*(?:(\d+):)?([0-5]?\d):([0-5]?\d[.,]\d{1,3})/;

function toSeconds(hours: string | undefined, minutes: string, seconds: string) {
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds.replace(",", "."));
}

export class CaptionFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptionFormatError";
  }
}

/**
 * Validates a WebVTT payload and reports its shape. Content is stored verbatim
 * — this only confirms the file is really a caption track and records enough
 * to show the upload was complete.
 */
export function parseVtt(content: string): ParsedVtt {
  const text = content.replace(/^﻿/, "");
  if (!/^\s*WEBVTT/.test(text)) {
    throw new CaptionFormatError("Not a WebVTT file (missing the WEBVTT header)");
  }

  let cueCount = 0;
  let lastCueEndSeconds: number | null = null;

  for (const line of text.split(/\r?\n/)) {
    const timing = CUE_TIMING.exec(line);
    if (!timing) continue;
    cueCount += 1;
    const end = toSeconds(timing[4], timing[5], timing[6]);
    if (lastCueEndSeconds === null || end > lastCueEndSeconds) lastCueEndSeconds = end;
  }

  if (cueCount === 0) throw new CaptionFormatError("No caption cues found in this file");
  return { cueCount, lastCueEndSeconds };
}
