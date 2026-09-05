"use client";

import { AlertTriangle, CheckCircle2, FileQuestion, HelpCircle, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  ApiError,
  type CaptionCoverage,
  type CaptionResult,
  type CaptionUploadFile,
} from "@/lib/client-api";
import { AppHeader } from "./app-header";
import { ErrorState } from "./ui";

// Caption files are large; sending them in batches keeps each request modest
// and lets results appear while the rest are still uploading.
const BATCH_SIZE = 10;

function folderOf(path: string[]) {
  return path.filter(Boolean).join(" / ");
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

export function CaptionsClient() {
  const [coverage, setCoverage] = useState<CaptionCoverage | null>(null);
  const [results, setResults] = useState<CaptionResult[]>([]);
  const [contents, setContents] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadCoverage = useCallback(() => {
    api
      .captionCoverage()
      .then(setCoverage)
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : "Could not load coverage"));
  }, []);

  useEffect(loadCoverage, [loadCoverage]);

  const upload = useCallback(
    async (files: CaptionUploadFile[]) => {
      setError(null);
      setBusy({ done: 0, total: files.length });
      try {
        for (let index = 0; index < files.length; index += BATCH_SIZE) {
          const batch = files.slice(index, index + BATCH_SIZE);
          const batchResults = await api.uploadCaptions(batch);
          setResults((previous) => {
            const names = new Set(batchResults.map((result) => result.name));
            return [...previous.filter((result) => !names.has(result.name)), ...batchResults];
          });
          setBusy({ done: Math.min(index + BATCH_SIZE, files.length), total: files.length });
        }
        loadCoverage();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Upload failed");
      } finally {
        setBusy(null);
      }
    },
    [loadCoverage],
  );

  const accept = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const files = Array.from(fileList).filter((file) => /\.(vtt|srt)$/i.test(file.name));
      if (!files.length) {
        setError("Choose subtitle files in .srt or .vtt format.");
        return;
      }

      try {
        const payload = await Promise.all(
          files.map(async (file) => ({ content: await readFile(file), name: file.name })),
        );
        setContents((previous) => {
          const next = new Map(previous);
          for (const file of payload) next.set(file.name, file.content);
          return next;
        });
        await upload(payload);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not read those files");
      }
    },
    [upload],
  );

  const resolve = useCallback(
    async (name: string, videoId: string) => {
      const content = contents.get(name);
      if (!content || !videoId) return;
      await upload([{ content, name, videoId }]);
    },
    [contents, upload],
  );

  const groups = useMemo(
    () => ({
      saved: results.filter((result) => result.status === "saved"),
      needsChoice: results.filter((result) => result.status === "ambiguous" || result.status === "unmatched"),
      invalid: results.filter((result) => result.status === "invalid"),
    }),
    [results],
  );

  const missing = coverage ? coverage.total - coverage.withCaptions : 0;

  return (
    <>
      <AppHeader title="Captions" />
      <main className="focus-main captions-page">
        <header className="page-head">
          <h1>Captions</h1>
          {coverage && (
            <p className="captions-page__coverage">
              <strong>{coverage.withCaptions}</strong> of {coverage.total} videos have a caption track
              {missing > 0 && <> · {missing} still missing</>}
            </p>
          )}
        </header>

        {error && <ErrorState message={error} onRetry={() => setError(null)} />}

        <section
          className={`captions-drop ${dragging ? "captions-drop--active" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void accept(event.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
        >
          <Upload size={28} aria-hidden="true" />
          <p>
            <strong>Drop your .srt or .vtt files here</strong>
          </p>
          <p className="captions-drop__hint">
            Each track is matched to its video, prepared for playback, and added to transcript search.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".vtt,.srt,text/vtt"
            multiple
            hidden
            onChange={(event) => {
              void accept(event.target.files);
              event.target.value = "";
            }}
          />
        </section>

        {busy && (
          <p className="captions-progress" role="status">
            Uploading {busy.done} of {busy.total}…
          </p>
        )}

        {groups.needsChoice.length > 0 && (
          <section className="captions-section">
            <h2>
              <HelpCircle size={16} aria-hidden="true" /> Needs a choice ({groups.needsChoice.length})
            </h2>
            <p className="captions-section__hint">
              These filenames don&apos;t point at exactly one video. Pick the right one — nothing is saved
              until you do.
            </p>
            <ul className="captions-list">
              {groups.needsChoice.map((result) => (
                <li key={result.name} className="captions-row">
                  <span className="captions-row__name truncate" title={result.name}>
                    {result.name}
                  </span>
                  <ChoicePicker
                    result={result}
                    videos={coverage?.videos ?? []}
                    onResolve={(videoId) => void resolve(result.name, videoId)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.invalid.length > 0 && (
          <section className="captions-section">
            <h2>
              <AlertTriangle size={16} aria-hidden="true" /> Couldn&apos;t read ({groups.invalid.length})
            </h2>
            <ul className="captions-list">
              {groups.invalid.map((result) => (
                <li key={result.name} className="captions-row">
                  <span className="captions-row__name truncate">{result.name}</span>
                  <span className="captions-row__detail">
                    {result.status === "invalid" ? result.reason : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {groups.saved.length > 0 && (
          <section className="captions-section">
            <h2>
              <CheckCircle2 size={16} aria-hidden="true" /> Saved ({groups.saved.length})
            </h2>
            <ul className="captions-list">
              {groups.saved.map((result) => (
                <li key={result.name} className="captions-row">
                  <span className="captions-row__name truncate" title={result.name}>
                    {result.name}
                  </span>
                  <span className="captions-row__detail">
                    {result.status === "saved" && (
                      <>
                        → {folderOf(result.videoPath)} · {result.cueCount} cues
                        {result.confidence === "fuzzy" && (
                          <em className="captions-row__flag"> matched loosely — worth a check</em>
                        )}
                        {result.confidence === "duration" && (
                          <em className="captions-row__flag"> matched by runtime</em>
                        )}
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {coverage && missing > 0 && results.length === 0 && (
          <section className="captions-section">
            <h2>
              <FileQuestion size={16} aria-hidden="true" /> Still missing ({missing})
            </h2>
            <ul className="captions-list captions-list--quiet">
              {coverage.videos
                .filter((video) => video.cueCount === null)
                .slice(0, 50)
                .map((video) => (
                  <li key={video.id} className="captions-row">
                    <span className="captions-row__name truncate" title={video.name}>
                      {video.name}
                    </span>
                    <span className="captions-row__detail">{folderOf(video.path)}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function ChoicePicker({
  result,
  videos,
  onResolve,
}: {
  result: CaptionResult;
  videos: CaptionCoverage["videos"];
  onResolve: (videoId: string) => void;
}) {
  const [choice, setChoice] = useState("");
  if (result.status !== "ambiguous" && result.status !== "unmatched") return null;

  // An ambiguous name has a short candidate list; an unmatched one needs the
  // whole library to choose from.
  const options = result.candidates.length
    ? result.candidates
    : videos.map((video) => ({ id: video.id, name: video.name, path: video.path }));

  return (
    <span className="captions-row__choice">
      <select value={choice} onChange={(event) => setChoice(event.target.value)} aria-label={`Video for ${result.name}`}>
        <option value="">
          {result.candidates.length ? "Choose one of the matches…" : "Choose a video…"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {folderOf(option.path)} — {option.name}
          </option>
        ))}
      </select>
      <button type="button" disabled={!choice} onClick={() => onResolve(choice)}>
        Save
      </button>
    </span>
  );
}
