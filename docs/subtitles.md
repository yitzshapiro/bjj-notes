# Generate SRT subtitles with Deepgram

The standalone script downloads the configured Google Drive video library,
extracts its first audio track, transcribes with **Deepgram Nova-3**, and writes
one local `.srt` per video. It defaults to English and uses no paid add-ons.
Drive and Neon remain read-only. Setting an API key does not start a job.

## Setup

Use Node 20.3+ and the repository's pnpm dependencies (`pnpm install`). Generation
requires `ffmpeg` and `ffprobe` on PATH; on macOS, `brew install ffmpeg` supplies
both when they are not already installed.

Put your Deepgram key in the ignored `.env.local`:

```dotenv
DEEPGRAM_API_KEY=your-deepgram-key
```

The script also uses the existing `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`DRIVE_ROOT_FOLDER_ID`, and optional `DATABASE_URL`. It needs a standalone Google
refresh token; the app's encrypted browser session is not reused.

On that Google OAuth **Web application** client, add this authorized redirect URI:

```text
http://127.0.0.1:53682/oauth/callback
```

When ready to authorize Google downloads, run:

```bash
pnpm subtitles:auth
```

Open the printed consent URL yourself and authorize the account that can read the
video library. This explicit command starts a temporary loopback callback listener
for up to five minutes; it does not start the BJJ app or transcription. It requests
only `drive.readonly` and saves the refresh token with owner-only permissions in
ignored `.subtitles/google-auth.json`. Access tokens renew automatically. If Google
expires a testing-mode refresh token, authorize again and resume the job.

Alternatively, set `GOOGLE_REFRESH_TOKEN` for the configured OAuth client; it takes
precedence over the saved token. `GOOGLE_ACCESS_TOKEN` supports temporary access
but needs renewal for long runs. Credentials are never printed.

## Estimate cost and time

```bash
pnpm subtitles:estimate
pnpm subtitles:estimate --credit-usd 200
pnpm subtitles:estimate --json
```

These read the active videos below the configured root from the saved Neon index,
print its sync date, and make no media downloads or Deepgram API calls. After
Google authorization, `--source drive` refreshes the recursive metadata inventory
without downloading media or transcribing.

The September 5 estimate from the August 31 saved inventory contains **381
videos**, **408.01 known audio hours**, **18 videos with missing/zero durations**,
and **289.45 GB** of video. Ten-minute chunks produce **2,633 requests** for the
known durations. All estimates cover the entire selected library, including
already completed outputs. During generation, ffprobe measures every video's
actual audio duration, including videos whose saved duration is missing.

Nova-3 English pre-recorded transcription is listed at **$0.0043 per audio
minute**, approximately **$105.27 for the known footage**, before credits. Missing
durations and retries add to that amount. Deepgram advertises **$200 signup
credit**, which would cover the known workload if the full credit is available.
The script does not check or assume your account balance. `--credit-usd` only
changes the estimate; it is not a spending cap.
[Deepgram pricing](https://deepgram.com/pricing),
[signup credit](https://developers.deepgram.com/guides/fundamentals/make-your-first-api-request).

The script runs **four chunks concurrently** by default, with a configurable
maximum of 50. Deepgram lists up to 50 concurrent pre-recorded Nova-3 requests per
primary pay-as-you-go project; your actual project limit may be lower. There is no
simulated daily quota wait. Requests retry after HTTP 429 with server backoff.
[Deepgram limits](https://developers.deepgram.com/reference/api-rate-limits).

A one-day target depends on download speed, extraction, upload speed, API latency,
retries, and unmeasured videos. No live speed benchmark is assumed. For example,
289.45 GB takes about **6.4 hours at a sustained 100 Mbps** for source downloads
alone. Optional timing scenarios accept your own measured or assumed values:

```bash
pnpm subtitles:estimate --download-mbps 100 --request-seconds 30 --concurrency 4
```

`--request-seconds` describes an assumed elapsed time per chunk, including encoding,
upload and API response. This is a scenario, not a benchmark. The calculation
accounts for sequential videos and parallel chunks within each video. Source
transfer time and chunk processing are printed separately; retries and unknown
videos remain additional work.

## Generate when ready

Authorize Google and configure the key first. A short selection is useful for
checking transcript quality and measuring speed:

```bash
pnpm subtitles:generate --limit 1
pnpm subtitles:generate --video-id YOUR_DRIVE_VIDEO_ID
```

To transcribe the full library:

```bash
pnpm subtitles:generate
```

Change concurrency to match the project and machine:

```bash
pnpm subtitles:generate --concurrency 4
```

The local pipeline downloads one video at a time, decodes it to 16 kHz mono PCM,
and creates distinct lossless FLAC chunks for the concurrent workers. Each worker
saves its transcript atomically. SRT cues are assembled in timeline order even
when requests finish out of order. Completed source/audio caches are removed;
completed transcript chunks remain available for resuming or rebuilding outputs.

Ctrl-C stops safely and waits for active work and media subprocesses to settle.
Repeat the command to resume. HTTP 400/401/403 configuration/access failures and
HTTP 402 insufficient credits stop the job; the script never switches providers
or enables extra features. Ordinary per-video failures are recorded and cause a
nonzero exit status. In-flight successful chunks remain saved if a sibling fails.

Other options: `--chunk-seconds 600` (maximum 720), `--language en`, `--output
subtitles`, and `--help`. `--language auto` enables Deepgram language detection,
which may select a fallback model for unsupported languages; its estimate uses a
higher multilingual price allowance. Use explicit English for the intended Nova-3
English run. Whisper-style prompts and paid keyterm prompting are not enabled.
[Language detection](https://developers.deepgram.com/docs/language-detection).

## Outputs and recovery

- Outputs mirror the Drive hierarchy under `subtitles/`. `Volume 1.mp4` becomes
  `Volume 1.mp4.srt`. Duplicate paths get stable ID suffixes and filesystem-unsafe
  characters are encoded. The full original names remain in the inventory.
- Deepgram word timestamps are grouped into readable cues using sentence endings,
  pauses, and length limits, then offset to the original video timeline. Initial
  silence is preserved. Audio chunks are contiguous without overlap, so review
  speech crossing chunk boundaries if exact word continuity matters.
- `.subtitles/work/` contains per-chunk responses and temporary media.
  `.subtitles/state.json` tracks source/model fingerprints, outputs, and recent
  attempted requests. Shared state writes are serialized so parallel completions
  cannot overwrite newer progress. Keep checkpoints when resuming.
- Source version, size, language, model/provider, or chunk-setting changes
  invalidate the affected cache. Existing edited or untracked SRTs are preserved
  and reported. No-speech videos produce an explicitly tracked empty SRT.
- Missing completed outputs can be rebuilt from cached transcript chunks without
  another transcription request. Interrupted downloads restart that one download;
  successful transcription chunks are retained.
- `.subtitles/run.lock` prevents concurrent jobs in the checkout. After an abrupt
  kill, verify that its recorded process is stopped, then remove only the lock and
  resume. An ordinary Ctrl-C releases it after workers finish shutting down.
- The generated files are local SRTs. The script does not attach them to Drive
  videos or import them into the app's existing WebVTT caption uploader.

## Import captions into the app

After generation and terminology cleanup, apply the checked-in database
migrations and import completed transcripts:

```bash
pnpm subtitles:import
pnpm subtitles:import --apply
pnpm subtitles:import --verify
```

The default command previews the import. The importer matches exact video IDs
from `.subtitles/state.json` and checks the source inventory, current library
metadata, and output hashes. It converts SRT into non-overlapping WebVTT, saves
each caption and its search index in one transaction, and skips identical tracks
with current indexes. Replaced tracks and per-video receipts are backed up under
`.subtitles/app-import/`. Incomplete or empty transcripts are reported separately;
empty output is not assumed to prove silent audio. No transcription API is called.

The Captions page also accepts both SRT and WebVTT uploads. New uploads use the
same normalization and indexing. Stored captions are versioned for playback so
an updated track can replace an older cached one. Original local SRTs stay intact.

Use the Library search box, or the header's Search button, to search video titles
and spoken words. Spoken matches show the title, folder, excerpt, and timestamp.
Choose a match to open that video at its exact cue start, including time zero.
Search recognizes the reviewed Japanese spelling variants and can find phrases
that cross two adjacent cues. It uses a PostgreSQL index, with bounded pagination,
rather than downloading full transcripts to the browser.

## Japanese terminology cleanup

Generated and rebuilt SRTs now standardize reviewed Japanese technique spellings
using `scripts/lib/subtitle-terminology.json`. For example, `Ashigurami` becomes
`Ashi garami`, `Sumigeshi` becomes `Sumi gaeshi`, and `Judigatami` becomes
`Juji gatame`. The raw cached provider responses remain available unchanged.
The glossary uses space-separated romanization for searching. Technique names
were checked against the [IJF technique index](https://judo.ijf.org/); BJJ-specific
modifiers retain the names used in the instructionals.

To scan existing local SRT and WebVTT files:

```bash
pnpm subtitles:normalize
pnpm subtitles:normalize --apply
```

The first command previews counts. `--apply` backs up every changed original and
the generation checkpoint under `.subtitles/terminology-backups/`, records each
replacement and file hash in `report.json`, and verifies preserved cue numbers,
timestamps, markup, and line endings. It updates known output hashes so generation
can resume. It uses the same job lock as generation and refuses unexpected edits
to tracked files. This command is entirely local and does not call a transcription
API, download media, or update captions stored in the app.

Matching uses reviewed whole words and phrases rather than fuzzy replacement.
Ordinary English, valid abbreviations such as `ashi` and `juji`, and ambiguous
technique fragments are retained. Terms broken across separate subtitle cues can
still need manual review. This is terminology cleanup, not an audio-verified
transcription pass. Backups, contextual findings, and a summary of the September 5
correction pass are in `.subtitles/terminology-audit/` and
`.subtitles/terminology-backups/` locally (both ignored by Git).
