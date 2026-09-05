import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeepgramFatalError, DeepgramTranscriber, deepgramRetryAfterMs, parseDeepgramTranscript, waitForDeepgramRetry } from "./subtitle-deepgram";

function result(words: unknown[], transcript = "Some speech") {
  return { results: { channels: [{ alternatives: [{ transcript, words }] }] } };
}

const success = () => Response.json(result([{ word: "frame", punctuated_word: "Frame.", start: 0.25, end: 0.75 }]));

describe("Deepgram word timestamps", () => {
  it("groups punctuation and pauses without removing leading silence or changing timestamps", () => {
    expect(parseDeepgramTranscript(result([
      { word: "frame", punctuated_word: "Frame", start: 5.125, end: 5.4 },
      { word: "here", punctuated_word: "here.", start: 5.45, end: 5.75 },
      { word: "then", punctuated_word: "Then", start: 5.9, end: 6.1 },
      { word: "turn", start: 7.2, end: 7.6 },
    ]))).toEqual([
      { start: 5.125, end: 5.75, text: "Frame here." },
      { start: 5.9, end: 6.1, text: "Then" },
      { start: 7.2, end: 7.6, text: "turn" },
    ]);
  });

  it("splits long speech at word boundaries and preserves every word", () => {
    const words = Array.from({ length: 30 }, (_, index) => ({ word: "technique", start: 3 + index * 0.25, end: 3.2 + index * 0.25 }));
    const segments = parseDeepgramTranscript(result(words));
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((segment) => segment.text.length <= 84 && segment.end - segment.start <= 6)).toBe(true);
    expect(segments.map((segment) => segment.text).join(" ")).toBe(words.map((word) => word.word).join(" "));
    expect(segments[0].start).toBe(3);
    expect(segments.at(-1)?.end).toBe(10.45);
  });

  it("splits a cue at six seconds even when the text is short", () => {
    const words = Array.from({ length: 9 }, (_, index) => ({ word: "a", start: 10 + index * 0.9, end: 10.5 + index * 0.9 }));
    const segments = parseDeepgramTranscript(result(words));
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.end - segment.start <= 6)).toBe(true);
    expect(segments.map((segment) => segment.text).join(" ")).toBe("a a a a a a a a a");
  });

  it("accepts explicit silence", () => {
    expect(parseDeepgramTranscript(result([], ""))).toEqual([]);
  });

  it.each([
    null,
    {},
    { results: { channels: [] } },
    { results: { channels: [{ alternatives: [{ transcript: "Speech", words: undefined }] }] } },
    result([], "Speech without timestamps"),
    result([{ word: "invalid", start: Number.NaN, end: 1 }]),
    result([{ word: "invalid", start: -1, end: 1 }]),
    result([{ word: "invalid", start: 2, end: 1 }]),
    result([{ word: "invalid", start: 1, end: 1 }]),
    result([{ word: "first", start: 2, end: 3 }, { word: "second", start: 1, end: 2 }]),
    result([{ word: "", start: 0, end: 1 }]),
  ])("rejects malformed or missing speech timestamps %#", (value) => {
    expect(() => parseDeepgramTranscript(value)).toThrow(/Deepgram/u);
  });
});

describe("Deepgram transcription request", () => {
  let directory: string;
  let file: string;
  let bytes: Buffer;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "subtitle-deepgram-test-"));
    file = path.join(directory, "audio.flac");
    bytes = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(100, 3)]);
    await writeFile(file, bytes);
    // Every test is offline; an unspecified response must fail the test.
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked test request"); }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  function client(options: Partial<ConstructorParameters<typeof DeepgramTranscriber>[0]> = {}) {
    return new DeepgramTranscriber({ apiKey: "fixture-key-not-real", signal: new AbortController().signal, ...options });
  }

  it("records before raw FLAC upload and sets only Nova-3 language/formatting parameters", async () => {
    const order: string[] = [];
    const onAttempt = vi.fn(async (seconds: number) => { expect(seconds).toBe(12.25); order.push("record"); });
    const fetch = vi.fn(async (urlString: string, init: RequestInit) => {
      order.push("fetch");
      const url = new URL(urlString);
      expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/listen");
      expect(Object.fromEntries(url.searchParams)).toEqual({ model: "nova-3", language: "en", smart_format: "true", punctuate: "true" });
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("Authorization")).toBe("Token fixture-key-not-real");
      expect(new Headers(init.headers).get("Content-Type")).toBe("audio/flac");
      expect(init.body).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(init.body as Uint8Array)).toEqual(bytes);
      return success();
    });
    vi.stubGlobal("fetch", fetch);
    const transcriber = client({ onAttempt });
    expect(transcriber.identity).toEqual({ provider: "deepgram", model: "nova-3" });
    expect(await transcriber.transcribe(file, 12.25, "en", "")).toEqual([{ start: 0.25, end: 0.75, text: "Frame." }]);
    expect(order).toEqual(["record", "fetch"]);
  });

  it.each(["es", "auto"])("supports language %s without addon parameters", async (language) => {
    const fetch = vi.fn(async (urlString: string) => {
      expect(Object.fromEntries(new URL(urlString).searchParams)).toEqual({
        model: "nova-3", smart_format: "true", punctuate: "true",
        ...(language === "auto" ? { detect_language: "true" } : { language }),
      });
      return success();
    });
    vi.stubGlobal("fetch", fetch);
    await client().transcribe(file, 1, language, "");
  });

  it("rejects prompts before uploading rather than enabling keyterm charges", async () => {
    await expect(client().transcribe(file, 1, "en", "BJJ terminology")).rejects.toBeInstanceOf(DeepgramFatalError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send a request if durable attempt recording fails", async () => {
    await expect(client({ onAttempt: async () => { throw new Error("Checkpoint write failed"); } }).transcribe(file, 1, "en", "")).rejects.toThrow("Checkpoint write failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([400, 401, 402, 403])("halts immediately on HTTP %s without exposing response secrets", async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response("fixture-key-not-real private response", { status }));
    const onAttempt = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetch);
    const transcriber = client({ onAttempt });
    const error = await transcriber.transcribe(file, 1, "en", "").catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DeepgramFatalError);
    expect(transcriber.failure).toBe(error);
    expect((error as DeepgramFatalError).status).toBe(status);
    expect((error as Error).message).not.toContain("fixture-key-not-real");
    expect((error as Error).message).not.toContain("private response");
    if (status === 402) expect((error as Error).message).toContain("credits are insufficient");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenCalledTimes(1);
  });

  it("latches a sibling billing failure before a transient worker retries or a later job begins", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503, headers: { "Retry-After": "120" } }))
      .mockResolvedValueOnce(new Response("insufficient credits", { status: 402 }));
    const onAttempt = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetch);
    const transcriber = client({ onAttempt });
    const retrying = transcriber.transcribe(file, 1, "en", "").catch((error: unknown) => error);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const failed = await transcriber.transcribe(file, 1, "en", "").catch((error: unknown) => error);
    expect(failed).toBeInstanceOf(DeepgramFatalError);
    expect(transcriber.failure?.status).toBe(402);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await retrying).toBe(failed);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenCalledTimes(2);
    // A nonexistent file proves the failure is checked before any file read.
    await expect(transcriber.transcribe(path.join(directory, "does-not-exist.flac"), 1, "en", "")).rejects.toBe(failed);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenCalledTimes(2);
  });

  it("checks the shared failure again after an awaited attempt reservation", async () => {
    let releaseReservation!: () => void;
    const reservation = new Promise<void>((resolve) => { releaseReservation = resolve; });
    const onAttempt = vi.fn(async (seconds: number) => { if (seconds === 1) await reservation; });
    const fetch = vi.fn().mockResolvedValue(new Response("invalid auth", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const transcriber = client({ onAttempt });
    const queued = transcriber.transcribe(file, 1, "en", "").catch((error: unknown) => error);
    await vi.waitFor(() => expect(onAttempt).toHaveBeenCalledWith(1));
    const failure = await transcriber.transcribe(file, 2, "en", "").catch((error: unknown) => error);
    releaseReservation();
    expect(await queued).toBe(failure);
    expect(transcriber.failure?.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns an already submitted successful response after a sibling fails so it can be checkpointed", async () => {
    let finishResponse!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => { finishResponse = resolve; });
    const fetch = vi.fn()
      .mockReturnValueOnce(pendingResponse)
      .mockResolvedValueOnce(new Response("insufficient credits", { status: 402 }));
    vi.stubGlobal("fetch", fetch);
    const transcriber = client();
    const successful = transcriber.transcribe(file, 1, "en", "");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await expect(transcriber.transcribe(file, 2, "en", "")).rejects.toBeInstanceOf(DeepgramFatalError);
    finishResponse(success());
    await expect(successful).resolves.toEqual([{ start: 0.25, end: 0.75, text: "Frame." }]);
    expect(transcriber.failure?.status).toBe(402);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([429, 503])("retries HTTP %s and records each attempt", async (status) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("retry", { status, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(success());
    const onAttempt = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetch);
    expect(await client({ onAttempt }).transcribe(file, 1, "en", "")).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenCalledTimes(2);
  });

  it("bounds repeated rate-limit retries to eight requests", async () => {
    const fetch = vi.fn(async () => new Response("retry", { status: 429, headers: { "Retry-After": "0" } }));
    const onAttempt = vi.fn(async () => {});
    vi.stubGlobal("fetch", fetch);
    await expect(client({ onAttempt }).transcribe(file, 1, "en", "")).rejects.toThrow("after eight attempts");
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(onAttempt).toHaveBeenCalledTimes(8);
  });

  it("retries a network failure after backoff without exposing the network error", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockRejectedValueOnce(new Error("fixture-key-not-real network failure")).mockResolvedValueOnce(success());
    vi.stubGlobal("fetch", fetch);
    const pending = client().transcribe(file, 1, "en", "");
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a server-requested long retry wait without another upload", async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async () => {
      queueMicrotask(() => controller.abort());
      return new Response("retry", { status: 429, headers: { "Retry-After": "3600" } });
    });
    vi.stubGlobal("fetch", fetch);
    await expect(client({ signal: controller.signal }).transcribe(file, 1, "en", "")).rejects.toThrow(/abort|cancel/iu);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Deepgram retry delays", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("honors seconds and HTTP dates, with safe invalid-value fallbacks", () => {
    expect(deepgramRetryAfterMs("2.5", 1000, 0)).toBe(2500);
    expect(deepgramRetryAfterMs("Thu, 01 Jan 1970 00:02:00 GMT", 1000, 0)).toBe(120_000);
    expect(deepgramRetryAfterMs(null, 1000, 0)).toBe(1000);
    expect(deepgramRetryAfterMs("not-a-date", 1000, 0)).toBe(1000);
    expect(deepgramRetryAfterMs("9".repeat(400), 1000, 0)).toBe(1000);
  });

  it("slices waits into timers of at most sixty seconds", async () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const wait = waitForDeepgramRetry(130_000, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(130_000);
    await wait;
    expect(timers.mock.calls.map((call) => call[1])).toEqual([60_000, 60_000, 10_000]);
  });

  it("cancels a timer promptly", async () => {
    const controller = new AbortController();
    const wait = waitForDeepgramRetry(120_000, controller.signal);
    controller.abort();
    await expect(wait).rejects.toThrow("cancelled");
  });
});
