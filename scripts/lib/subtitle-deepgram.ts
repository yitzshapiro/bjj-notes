import { readFile } from "node:fs/promises";

import type { Segment } from "./subtitle-core";

export class DeepgramFatalError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "DeepgramFatalError";
  }
}

type DeepgramWord = { word?: unknown; punctuated_word?: unknown; start?: unknown; end?: unknown };

/** Keep word timing intact, including initial silence and pauses between cues. */
export function parseDeepgramTranscript(value: unknown): Segment[] {
  const result = value as { results?: { channels?: { alternatives?: { transcript?: unknown; words?: unknown }[] }[] } } | null;
  const alternative = result?.results?.channels?.[0]?.alternatives?.[0];
  if (!alternative || typeof alternative.transcript !== "string" || !Array.isArray(alternative.words)) {
    throw new Error("Deepgram returned an invalid transcript or no word timestamps.");
  }
  if (!alternative.words.length) {
    if (alternative.transcript.trim()) throw new Error("Deepgram returned speech without word timestamps.");
    return [];
  }
  const output: Segment[] = [];
  let current: Segment | undefined;
  let previousStart = -1;
  const flush = () => {
    if (current) {
      if (current.end <= current.start) throw new Error("Deepgram returned speech without usable word durations.");
      output.push(current);
      current = undefined;
    }
  };
  for (const item of alternative.words) {
    const word = item as DeepgramWord | null;
    if (!word || typeof word.word !== "string" || !word.word.trim() ||
        (word.punctuated_word != null && typeof word.punctuated_word !== "string") ||
        typeof word.start !== "number" || !Number.isFinite(word.start) || word.start < 0 ||
        typeof word.end !== "number" || !Number.isFinite(word.end) || word.end < word.start || word.start < previousStart) {
      throw new Error("Deepgram returned invalid or unordered word timestamps.");
    }
    previousStart = word.start;
    const text = (typeof word.punctuated_word === "string" && word.punctuated_word.trim() ? word.punctuated_word : word.word).replace(/\s+/gu, " ").trim();
    if (current && (current.text.length + text.length + 1 > 84 ||
        word.end - current.start > 6 || word.start - current.end >= 0.8)) flush();
    if (current) {
      current.text += ` ${text}`;
      current.end = Math.max(current.end, word.end);
    } else {
      current = { start: word.start, end: word.end, text };
    }
    if (/[.!?。！？]["'”’\])}]*$/u.test(text)) flush();
  }
  flush();
  return output;
}

export function deepgramRetryAfterMs(value: string | null, fallback: number, now = Date.now()): number {
  if (!value) return fallback;
  if (/^\d+(\.\d+)?$/u.test(value.trim())) {
    const milliseconds = Number(value) * 1000;
    return Number.isFinite(milliseconds) ? Math.ceil(milliseconds) : fallback;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : fallback;
}

/** Long server retry delays stay interruptible and never use a timer over 60s. */
export async function waitForDeepgramRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        reject(new Error("Deepgram transcription was cancelled."));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancel);
        resolve();
      }, Math.min(60_000, until - Date.now()));
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
    });
    signal.throwIfAborted();
  }
}

export class DeepgramTranscriber {
  readonly identity = { provider: "deepgram", model: "nova-3" } as const;
  private fatalFailure: DeepgramFatalError | undefined;

  get failure(): DeepgramFatalError | undefined {
    return this.fatalFailure;
  }

  private throwIfFailed() {
    if (this.fatalFailure) throw this.fatalFailure;
  }

  constructor(private readonly options: {
    apiKey: string;
    signal: AbortSignal;
    onAttempt?: (seconds: number) => Promise<void>;
  }) {
    if (!options.apiKey.trim()) throw new DeepgramFatalError("Set DEEPGRAM_API_KEY before running transcription.");
  }

  async transcribe(file: string, seconds: number, language: string, prompt: string): Promise<Segment[]> {
    const { signal, onAttempt } = this.options;
    this.throwIfFailed();
    signal.throwIfAborted();
    if (prompt.trim()) throw new DeepgramFatalError("Deepgram transcription does not accept --prompt; keyterm prompting is not enabled.");
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Transcription audio duration must be positive and finite.");
    const selectedLanguage = language.trim().toLowerCase();
    if (selectedLanguage !== "auto" && !/^[a-z]{2}$/u.test(selectedLanguage)) {
      throw new DeepgramFatalError("Deepgram language must be a two-letter code such as en, or auto.");
    }
    const bytes = new Uint8Array(await readFile(file, { signal }));
    if (bytes.length <= 4 || Buffer.from(bytes.subarray(0, 4)).toString("ascii") !== "fLaC") {
      throw new Error("Deepgram transcription requires a nonempty FLAC audio chunk.");
    }
    const query = new URLSearchParams({ model: "nova-3", smart_format: "true", punctuate: "true" });
    if (selectedLanguage === "auto") query.set("detect_language", "true");
    else query.set("language", selectedLanguage);
    const url = `https://api.deepgram.com/v1/listen?${query}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      this.throwIfFailed();
      signal.throwIfAborted();
      // The caller durably records this attempt before any billable request.
      await onAttempt?.(seconds);
      this.throwIfFailed();
      signal.throwIfAborted();
      const backoff = Math.min(60_000, 1000 * 2 ** attempt);
      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { Authorization: `Token ${this.options.apiKey}`, "Content-Type": "audio/flac" },
          body: bytes,
          signal: AbortSignal.any([signal, AbortSignal.timeout(300_000)]),
        });
      } catch {
        this.throwIfFailed();
        signal.throwIfAborted();
        if (attempt === 7) throw new Error("Deepgram network request failed after eight attempts; rerun to resume.");
        await waitForDeepgramRetry(backoff, signal);
        continue;
      }
      if (response.ok) {
        let data: unknown;
        try { data = await response.json(); }
        catch {
          signal.throwIfAborted();
          throw new Error("Deepgram returned invalid or incomplete JSON. Rerun to retry this chunk.");
        }
        return parseDeepgramTranscript(data);
      }
      if ([400, 401, 402, 403].includes(response.status)) {
        const message = response.status === 402
          ? "Deepgram credits are insufficient (HTTP 402). Transcription stopped; check billing before resuming."
          : response.status === 400
            ? "Deepgram rejected the audio or model/language options (HTTP 400). Transcription stopped."
            : `Deepgram rejected access (HTTP ${response.status}); check DEEPGRAM_API_KEY and model permissions.`;
        // One worker's billing/auth failure stops new uploads on this shared
        // instance, even if the pool reports an earlier sibling error first.
        this.fatalFailure ??= new DeepgramFatalError(message, response.status);
        await response.body?.cancel().catch(() => {});
        throw this.fatalFailure;
      }
      await response.body?.cancel();
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`Deepgram transcription failed with HTTP ${response.status}.`);
      }
      if (attempt === 7) throw new Error(`Deepgram still returned HTTP ${response.status} after eight attempts; rerun to resume.`);
      this.throwIfFailed();
      await waitForDeepgramRetry(deepgramRetryAfterMs(response.headers.get("retry-after"), backoff), signal);
    }
    throw new Error("Deepgram transcription retry budget exhausted.");
  }
}
