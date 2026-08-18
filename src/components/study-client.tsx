"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Download,
  FileText,
  Gauge,
  ListVideo,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  RotateCcw,
  RotateCw,
  Settings2,
  Star,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  DivisionPreset,
  StudySection,
  TimestampNote,
  VideoProgress,
} from "@/lib/client-api";
import { formatDay, formatDuration, formatFocusAge, formatPercent } from "@/lib/format";
import {
  clampTime,
  DEFAULT_RATE,
  formatRate,
  isTypingTarget,
  loadStoredRate,
  matchShortcut,
  PLAYBACK_RATES,
  SKIP_SECONDS,
  stepRate,
  storeRate,
} from "@/lib/playback-rate";
import { AppHeader } from "./app-header";
import { ErrorState, LoadingState, ProgressBar } from "./ui";

type Panel = "timestamps" | "running" | "sections";
type SaveState = "idle" | "saving" | "saved" | "error";

const emptyProgress: VideoProgress = {
  positionSeconds: 0,
  durationSeconds: 0,
  completed: false,
  starred: false,
};

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className={`save-indicator save-indicator--${state}`} role="status">
      {state === "saving" ? (
        <LoaderCircle className="spin" size={12} />
      ) : state === "saved" ? (
        <Check size={12} />
      ) : (
        <X size={12} />
      )}
      {state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Not saved"}
    </span>
  );
}

function TimestampRow({
  note,
  onSeek,
  onSave,
  onDelete,
}: {
  note: TimestampNote;
  onSeek: () => void;
  onSave: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const [saving, setSaving] = useState(false);

  return (
    <article className="timestamp-note">
      <button
        className="time-chip"
        type="button"
        onClick={onSeek}
        aria-label={`Jump to ${formatDuration(note.timestampSeconds)}`}
      >
        <Clock3 size={12} /> {formatDuration(note.timestampSeconds)}
      </button>
      {editing ? (
        <textarea
          className="text-area text-area--compact"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          autoFocus
        />
      ) : (
        <p>{note.body}</p>
      )}
      <div className="timestamp-note__actions">
        {editing ? (
          <button
            className="text-button"
            type="button"
            disabled={saving || !body.trim()}
            onClick={async () => {
              setSaving(true);
              await onSave(body.trim());
              setSaving(false);
              setEditing(false);
            }}
          >
            <Save size={13} /> Save
          </button>
        ) : (
          <button
            className="icon-button icon-button--small"
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit note"
          >
            <Pencil size={13} />
          </button>
        )}
        <button
          className="icon-button icon-button--small icon-button--danger"
          type="button"
          onClick={() => void onDelete()}
          aria-label="Delete note"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  );
}

function PresetManager({
  presets,
  onClose,
  onChange,
}: {
  presets: DivisionPreset[];
  onClose: () => void;
  onChange: (presets: DivisionPreset[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const add = async () => {
    if (!label.trim()) return;
    setBusyId("new");
    try {
      const created = await api.savePreset({ label: label.trim() });
      onChange([...presets, created]);
      setLabel("");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="preset-title">
        <div className="modal-card__header">
          <h2 id="preset-title">Division presets</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close presets">
            <X size={17} />
          </button>
        </div>
        <p className="muted">
          Create the divisions you use across instructionals. You can add more detail to each section
          after applying one.
        </p>
        <div className="inline-add">
          <label>
            <span className="sr-only">Preset label</span>
            <input
              className="text-input"
              placeholder="e.g. Entries"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void add();
              }}
            />
          </label>
          <button
            className="button button--primary"
            type="button"
            disabled={!label.trim() || busyId === "new"}
            onClick={() => void add()}
          >
            <Plus size={15} /> Add
          </button>
        </div>
        <div className="preset-list">
          {presets.map((preset) => (
            <div className="preset-row" key={preset.id}>
              <input
                className="text-input"
                defaultValue={preset.label}
                aria-label={`Rename ${preset.label}`}
                onBlur={async (event) => {
                  const next = event.target.value.trim();
                  if (!next || next === preset.label) return;
                  setBusyId(preset.id);
                  const updated = await api.savePreset({ ...preset, label: next });
                  onChange(presets.map((item) => (item.id === preset.id ? updated : item)));
                  setBusyId(null);
                }}
              />
              <button
                className="icon-button icon-button--bordered icon-button--danger"
                type="button"
                disabled={busyId === preset.id}
                onClick={async () => {
                  setBusyId(preset.id);
                  await api.deletePreset(preset.id);
                  onChange(presets.filter((item) => item.id !== preset.id));
                  setBusyId(null);
                }}
                aria-label={`Delete ${preset.label}`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          {!presets.length ? (
            <div className="mini-empty">No presets yet. Add your first reusable division above.</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function sectionDetail(section: StudySection) {
  if (section.focused) return formatFocusAge(section.focusAddedAt);
  if (section.lastPracticedAt) return `Practiced ${formatDay(section.lastPracticedAt)}`;
  if (section.endSeconds != null) return `to ${formatDuration(section.endSeconds)}`;
  return null;
}

export function StudyClient({
  videoId,
  initialName,
  initialDuration,
  initialSeek = 0,
  playbackToken,
  streamVersion,
}: {
  videoId: string;
  initialName: string;
  initialDuration: number;
  initialSeek?: number;
  playbackToken: string;
  streamVersion: string;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedPosition = useRef(0);
  const lastUiUpdateAt = useRef(0);
  const pendingResumePosition = useRef<number | null>(null);
  const pendingSeekPosition = useRef<number | null>(null);
  const pendingDeepLink = useRef(initialSeek);
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [title, setTitle] = useState(initialName || "Instructional video");
  const [progress, setProgress] = useState<VideoProgress>(() => ({
    ...emptyProgress,
    durationSeconds: initialDuration,
  }));
  const [notes, setNotes] = useState<TimestampNote[]>([]);
  const [runningNote, setRunningNote] = useState("");
  const [sections, setSections] = useState<StudySection[]>([]);
  const [presets, setPresets] = useState<DivisionPreset[]>([]);
  const [activePanel, setActivePanel] = useState<Panel>("timestamps");
  const [newNote, setNewNote] = useState("");
  const [sectionOpen, setSectionOpen] = useState(false);
  const [presetManagerOpen, setPresetManagerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sectionLabel, setSectionLabel] = useState("");
  const [sectionPresetId, setSectionPresetId] = useState("");
  const [sectionStart, setSectionStart] = useState(0);
  const [sectionEnd, setSectionEnd] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [runningSaveState, setRunningSaveState] = useState<SaveState>("idle");
  const [mediaBusy, setMediaBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [rateMenuOpen, setRateMenuOpen] = useState(false);
  const [cue, setCue] = useState<{ id: number; icon: "faster" | "slower" | "back" | "forward"; text: string } | null>(
    null,
  );
  const cueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const restorePlaybackPosition = useCallback((video: HTMLVideoElement) => {
    const target = pendingResumePosition.current;
    if (target == null || target <= 0 || !Number.isFinite(video.duration)) return;
    pendingResumePosition.current = null;
    if (target < video.duration - 5 && video.currentTime < 1) video.currentTime = target;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [bundle, presetItems] = await Promise.all([
          api.video(videoId),
          api.presets().catch(() => []),
        ]);
        if (cancelled) return;
        setTitle(bundle.video?.name || initialName || "Instructional video");
        const nextProgress = {
          ...emptyProgress,
          ...(bundle.progress ?? {}),
        };
        if (!nextProgress.durationSeconds) nextProgress.durationSeconds = initialDuration;
        setProgress(nextProgress);
        lastSavedPosition.current = nextProgress.positionSeconds;
        // A division deep link takes precedence over the saved resume point.
        if (!pendingDeepLink.current) {
          pendingResumePosition.current = nextProgress.positionSeconds;
          if (videoRef.current?.readyState) restorePlaybackPosition(videoRef.current);
        }
        setNotes(Array.isArray(bundle.notes) ? bundle.notes : []);
        setRunningNote(bundle.runningNote?.body ?? "");
        setSections(Array.isArray(bundle.sections) ? bundle.sections : []);
        setPresets(Array.isArray(presetItems) ? presetItems : []);
      } catch (caught) {
        if (cancelled) return;
        if (caught instanceof ApiError && caught.status === 401) router.replace("/");
        else
          setError(
            caught instanceof Error ? caught.message : "This study workspace could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, [initialDuration, initialName, refreshKey, restorePlaybackPosition, router, videoId]);

  useEffect(
    () => () => {
      if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
      if (runningSaveTimer.current) clearTimeout(runningSaveTimer.current);
    },
    [],
  );

  const saveProgress = useCallback(
    async (next: Partial<VideoProgress>) => {
      setSaveState("saving");
      try {
        const saved = await api.saveProgress(videoId, next);
        setProgress((current) => ({ ...current, ...next, ...saved }));
        setSaveState("saved");
        window.setTimeout(() => setSaveState("idle"), 1600);
      } catch {
        setSaveState("error");
      }
    },
    [videoId],
  );

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const next = {
      positionSeconds: video.currentTime,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : progress.durationSeconds,
    };
    const now = performance.now();
    if (now - lastUiUpdateAt.current >= 750 || video.paused) {
      lastUiUpdateAt.current = now;
      setProgress((current) => ({ ...current, ...next }));
    }
    if (Math.abs(video.currentTime - lastSavedPosition.current) >= 15) {
      lastSavedPosition.current = video.currentTime;
      if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
      progressSaveTimer.current = setTimeout(() => void saveProgress(next), 750);
    }
  };

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(
      0,
      Math.min(seconds, Number.isFinite(video.duration) ? video.duration : seconds),
    );
    pendingSeekPosition.current = target;
    setMediaBusy(true);
    if (!video.readyState) {
      pendingResumePosition.current = target;
      video.load();
      return;
    }
    video.currentTime = target;
    void video.play().catch(() => undefined);
  };

  /** Brief centred readout so a shortcut visibly did something. */
  const showCue = useCallback((icon: "faster" | "slower" | "back" | "forward", text: string) => {
    setCue({ id: Date.now(), icon, text });
    if (cueTimer.current) clearTimeout(cueTimer.current);
    cueTimer.current = setTimeout(() => setCue(null), 900);
  }, []);

  const applyRate = useCallback(
    (next: number, announce = true) => {
      const video = videoRef.current;
      if (video) video.playbackRate = next;
      setRate(next);
      storeRate(next);
      if (announce) showCue(next > rate ? "faster" : "slower", formatRate(next));
    },
    [rate, showCue],
  );

  /** Nudge from wherever playback is now, without the seek()/autoplay behaviour. */
  const skipBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = clampTime(video.currentTime + seconds, video.duration);
  }, []);

  // Restore the speed chosen on a previous video. This has to run after mount
  // rather than as a lazy initial value — the server render cannot read
  // localStorage, and returning a different value during hydration would
  // mismatch the rendered "1×".
  useEffect(() => {
    const stored = loadStoredRate();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRate(stored);
    if (videoRef.current) videoRef.current.playbackRate = stored;
  }, []);

  useEffect(
    () => () => {
      if (cueTimer.current) clearTimeout(cueTimer.current);
    },
    [],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (presetManagerOpen) return;
      if (isTypingTarget(event.target as HTMLElement | null)) return;

      const action = matchShortcut(event);
      if (!action) return;
      // Stops the native <video> arrow seek from firing on top of ours.
      event.preventDefault();

      if (action.type === "rate") {
        applyRate(stepRate(rate, action.direction));
        return;
      }
      if (action.type === "skip") {
        skipBy(action.seconds);
        showCue(action.seconds < 0 ? "back" : "forward", `${Math.abs(action.seconds)}s`);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyRate, presetManagerOpen, rate, showCue, skipBy]);

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSaveState("saving");
    try {
      const note = await api.saveNote(videoId, {
        timestampSeconds: videoRef.current?.currentTime ?? progress.positionSeconds,
        body: newNote.trim(),
      });
      setNotes((current) =>
        [...current, note].sort((a, b) => a.timestampSeconds - b.timestampSeconds),
      );
      setNewNote("");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  const changeRunningNote = (body: string) => {
    setRunningNote(body);
    setRunningSaveState("saving");
    if (runningSaveTimer.current) clearTimeout(runningSaveTimer.current);
    runningSaveTimer.current = setTimeout(async () => {
      try {
        await api.saveRunningNote(videoId, body);
        setRunningSaveState("saved");
      } catch {
        setRunningSaveState("error");
      }
    }, 700);
  };

  const createSection = async () => {
    const preset = presets.find((item) => item.id === sectionPresetId);
    const label = sectionLabel.trim() || preset?.label;
    if (!label) return;
    const saved = await api.saveSection(videoId, {
      label,
      presetId: preset?.id ?? null,
      startSeconds: sectionStart,
      endSeconds: sectionEnd === "" ? null : sectionEnd,
      starred: false,
      focused: false,
    });
    setSections((current) =>
      [...current, saved].sort((a, b) => a.startSeconds - b.startSeconds),
    );
    setSectionOpen(false);
    setSectionLabel("");
    setSectionPresetId("");
    setSectionStart(videoRef.current?.currentTime ?? 0);
    setSectionEnd("");
  };

  const updateSection = async (
    section: StudySection,
    change: { starred?: boolean; focused?: boolean; markPracticed?: boolean },
  ) => {
    const optimistic = {
      ...section,
      ...change,
      ...(change.markPracticed
        ? { focused: false, practiceCount: section.practiceCount + 1, lastPracticedAt: new Date().toISOString() }
        : {}),
    };
    setSections((current) => current.map((item) => (item.id === section.id ? optimistic : item)));
    try {
      const saved = await api.saveSection(videoId, { id: section.id, ...change });
      setSections((current) => current.map((item) => (item.id === section.id ? saved : item)));
    } catch {
      setSections((current) => current.map((item) => (item.id === section.id ? section : item)));
    }
  };

  const duration = progress.durationSeconds || 0;
  const progressRatio = duration ? progress.positionSeconds / duration : 0;
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => a.timestampSeconds - b.timestampSeconds),
    [notes],
  );
  const focusedSections = sections.filter((section) => section.focused);

  return (
    <div className="app-page study-page">
      <AppHeader
        compact
        title={title}
        trailing={
          <div className="export-control">
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setExportOpen((value) => !value)}
              aria-expanded={exportOpen}
            >
              <Download size={15} />
              <span className="desktop-only">Export</span>
              <ChevronDown size={13} />
            </button>
            {exportOpen ? (
              <div className="export-menu">
                <strong>Export together</strong>
                <a href={`/api/export?videoId=${encodeURIComponent(videoId)}&format=markdown`}>
                  <FileText size={14} /> Markdown
                </a>
                <a href={`/api/export?videoId=${encodeURIComponent(videoId)}&format=json`}>
                  <FileText size={14} /> JSON
                </a>
                <strong>Export separately</strong>
                <a
                  href={`/api/export?videoId=${encodeURIComponent(videoId)}&format=timestamped-markdown`}
                >
                  Timestamped notes
                </a>
                <a href={`/api/export?videoId=${encodeURIComponent(videoId)}&format=running-text`}>
                  Running note
                </a>
              </div>
            ) : null}
          </div>
        }
      />
      <main className="study-layout">
        <section className="video-workspace">
          <div className="study-breadcrumb">
            <Link href="/library">
              <ArrowLeft size={14} /> Library
            </Link>
            <span>/</span>
            <span className="truncate">{title}</span>
          </div>

          <div className="video-frame">
            <video
              ref={videoRef}
              controls
              playsInline
              preload="auto"
              src={`/api/videos/${encodeURIComponent(videoId)}/stream?token=${encodeURIComponent(playbackToken)}&v=${encodeURIComponent(streamVersion)}`}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                if (pendingDeepLink.current > 0) {
                  const target = pendingDeepLink.current;
                  pendingDeepLink.current = 0;
                  video.currentTime = Number.isFinite(video.duration)
                    ? Math.min(target, Math.max(0, video.duration - 1))
                    : target;
                } else {
                  restorePlaybackPosition(video);
                  if (pendingSeekPosition.current != null) {
                    video.currentTime = pendingSeekPosition.current;
                  }
                }
                // A seek can call video.load(), which resets playbackRate to 1.
                video.playbackRate = rate;
                setProgress((current) => ({
                  ...current,
                  durationSeconds: Number.isFinite(video.duration)
                    ? video.duration
                    : current.durationSeconds,
                }));
              }}
              onSeeking={() => setMediaBusy(true)}
              onSeeked={(event) => {
                const shouldPlay = pendingSeekPosition.current != null;
                pendingSeekPosition.current = null;
                setMediaBusy(false);
                if (shouldPlay) void event.currentTarget.play().catch(() => undefined);
              }}
              onWaiting={() => setMediaBusy(true)}
              onCanPlay={() => {
                if (pendingSeekPosition.current == null) setMediaBusy(false);
              }}
              onTimeUpdate={handleTimeUpdate}
              onPause={() => {
                if (progressSaveTimer.current) clearTimeout(progressSaveTimer.current);
                const positionSeconds = videoRef.current?.currentTime ?? progress.positionSeconds;
                lastSavedPosition.current = positionSeconds;
                setProgress((current) => ({ ...current, positionSeconds }));
                void saveProgress({
                  positionSeconds,
                  durationSeconds: videoRef.current?.duration || progress.durationSeconds,
                });
              }}
              onEnded={() =>
                void saveProgress({
                  positionSeconds: videoRef.current?.duration || progress.durationSeconds,
                  durationSeconds: videoRef.current?.duration || progress.durationSeconds,
                  completed: true,
                })
              }
            >
              Your browser does not support HTML video.
            </video>
            {mediaBusy ? (
              <div className="video-buffering" role="status">
                <LoaderCircle className="spin" size={16} /> Loading video…
              </div>
            ) : null}
            {cue ? (
              <div className="video-cue" key={cue.id} aria-hidden="true">
                {cue.icon === "back" ? <RotateCcw size={20} /> : null}
                {cue.icon === "forward" ? <RotateCw size={20} /> : null}
                {cue.icon === "faster" || cue.icon === "slower" ? <Gauge size={20} /> : null}
                <strong>{cue.text}</strong>
              </div>
            ) : null}
          </div>

          <div className="player-bar">
            <div className="player-bar__group">
              <button
                className="icon-button icon-button--bordered"
                type="button"
                title={`Back ${SKIP_SECONDS} seconds (left arrow)`}
                aria-label={`Skip back ${SKIP_SECONDS} seconds`}
                onClick={() => {
                  skipBy(-SKIP_SECONDS);
                  showCue("back", `${SKIP_SECONDS}s`);
                }}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="icon-button icon-button--bordered"
                type="button"
                title={`Forward ${SKIP_SECONDS} seconds (right arrow)`}
                aria-label={`Skip forward ${SKIP_SECONDS} seconds`}
                onClick={() => {
                  skipBy(SKIP_SECONDS);
                  showCue("forward", `${SKIP_SECONDS}s`);
                }}
              >
                <RotateCw size={16} />
              </button>
            </div>

            <div className="player-bar__group speed-control">
              <button
                className={`button button--secondary ${rate !== DEFAULT_RATE ? "is-active" : ""}`}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={rateMenuOpen}
                title="Playback speed (shift + . faster, shift + , slower)"
                onClick={() => setRateMenuOpen((value) => !value)}
              >
                <Gauge size={15} />
                {formatRate(rate)}
                <ChevronDown size={13} />
              </button>
              {rateMenuOpen ? (
                <>
                  <div
                    className="speed-menu__scrim"
                    role="presentation"
                    onClick={() => setRateMenuOpen(false)}
                  />
                  <ul className="speed-menu" role="listbox" aria-label="Playback speed">
                    {PLAYBACK_RATES.map((option) => (
                      <li key={option}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={option === rate}
                          className={option === rate ? "is-active" : ""}
                          onClick={() => {
                            applyRate(option, false);
                            setRateMenuOpen(false);
                          }}
                        >
                          {formatRate(option)}
                          {option === rate ? <Check size={13} /> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>

            <div className="player-hints desktop-only" aria-hidden="true">
              <span><kbd>←</kbd><kbd>→</kbd> 10s</span>
              <span><kbd>shift</kbd>+<kbd>,</kbd> slower</span>
              <span><kbd>shift</kbd>+<kbd>.</kbd> faster</span>
            </div>
          </div>

          <div className="video-meta-card">
            <div className="video-title-row">
              <div>
                <h1>{title}</h1>
                <p className="meta-line">
                  <span>{formatPercent(progressRatio)} watched</span>
                  <span className="dot">·</span>
                  <span>{sections.length} divisions</span>
                  <span className="dot">·</span>
                  <span>{notes.length} notes</span>
                </p>
              </div>
              <button
                className={`icon-button icon-button--bordered ${progress.starred ? "is-starred" : ""}`}
                type="button"
                aria-label={progress.starred ? "Remove video from starred" : "Star video"}
                aria-pressed={progress.starred}
                onClick={() => void saveProgress({ starred: !progress.starred })}
              >
                <Star size={17} fill={progress.starred ? "currentColor" : "none"} />
              </button>
            </div>

            <div className="playback-progress">
              <div>
                <span>{formatDuration(progress.positionSeconds)}</span>
                <SaveIndicator state={saveState} />
                <span>{formatDuration(duration)}</span>
              </div>
              <ProgressBar value={progressRatio} label={`${formatPercent(progressRatio)} watched`} />
            </div>

            {focusedSections.length ? (
              <div className="focus-list">
                <div className="focus-list__head">
                  <Target size={14} /> In focus
                </div>
                <div className="focus-list__items">
                  {focusedSections.map((section) => (
                    <button
                      key={section.id}
                      className="focus-chip"
                      type="button"
                      onClick={() => seek(section.startSeconds)}
                    >
                      {section.label} · {formatDuration(section.startSeconds)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="study-panel">
          <div className="panel-tabs" role="tablist" aria-label="Study tools">
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "timestamps"}
              className={activePanel === "timestamps" ? "is-active" : ""}
              onClick={() => setActivePanel("timestamps")}
            >
              <span>Time notes</span>
              <small>{notes.length}</small>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "running"}
              className={activePanel === "running" ? "is-active" : ""}
              onClick={() => setActivePanel("running")}
            >
              <span>Running</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activePanel === "sections"}
              className={activePanel === "sections" ? "is-active" : ""}
              onClick={() => setActivePanel("sections")}
            >
              <span>Divisions</span>
              <small>{sections.length}</small>
            </button>
          </div>

          <div className="panel-content">
            {loading ? <LoadingState label="Loading notes and divisions…" /> : null}
            {!loading && error ? (
              <ErrorState message={error} onRetry={() => setRefreshKey((value) => value + 1)} />
            ) : null}

            {!loading && !error && activePanel === "timestamps" ? (
              <section aria-labelledby="timestamps-title">
                <div className="panel-heading">
                  <h2 id="timestamps-title">Timestamped notes</h2>
                  <span className="current-time">{formatDuration(progress.positionSeconds)}</span>
                </div>
                <div className="note-composer">
                  <textarea
                    className="text-area"
                    value={newNote}
                    onChange={(event) => setNewNote(event.target.value)}
                    placeholder="What happened here? Add a detail, cue, or question…"
                    rows={4}
                  />
                  <button
                    className="button button--primary button--full"
                    type="button"
                    disabled={!newNote.trim()}
                    onClick={() => void addNote()}
                  >
                    <Plus size={15} /> Add at {formatDuration(progress.positionSeconds)}
                  </button>
                </div>
                <div className="timestamp-list">
                  {sortedNotes.map((note) => (
                    <TimestampRow
                      key={note.id}
                      note={note}
                      onSeek={() => seek(note.timestampSeconds)}
                      onSave={async (body) => {
                        const saved = await api.saveNote(videoId, { ...note, body });
                        setNotes((current) =>
                          current.map((item) => (item.id === note.id ? saved : item)),
                        );
                      }}
                      onDelete={async () => {
                        await api.deleteNote(videoId, note.id);
                        setNotes((current) => current.filter((item) => item.id !== note.id));
                      }}
                    />
                  ))}
                  {!notes.length ? (
                    <div className="mini-empty">
                      <Clock3 size={19} />
                      <strong>No timestamped notes yet</strong>
                      <span>Pause anywhere and capture the detail you want to remember.</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {!loading && !error && activePanel === "running" ? (
              <section className="running-panel" aria-labelledby="running-title">
                <div className="panel-heading">
                  <h2 id="running-title">Running note</h2>
                  <SaveIndicator state={runningSaveState} />
                </div>
                <p className="panel-description">
                  Use this for themes, questions, and takeaways that aren’t tied to one moment.
                </p>
                <textarea
                  className="text-area running-note"
                  value={runningNote}
                  onChange={(event) => changeRunningNote(event.target.value)}
                  placeholder="Start your running notes…"
                  aria-label="Running notes"
                />
              </section>
            ) : null}

            {!loading && !error && activePanel === "sections" ? (
              <section aria-labelledby="sections-title">
                <div className="panel-heading">
                  <h2 id="sections-title">Divisions</h2>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={() => setPresetManagerOpen(true)}
                    aria-label="Manage division presets"
                  >
                    <Settings2 size={16} />
                  </button>
                </div>
                <p className="panel-description">
                  Mark techniques and chapters, then star them or add them to this week’s focus.
                </p>
                <button
                  className="button button--secondary button--full"
                  type="button"
                  onClick={() => {
                    setSectionStart(videoRef.current?.currentTime ?? progress.positionSeconds);
                    setSectionOpen((value) => !value);
                  }}
                >
                  <Plus size={15} /> Add division at {formatDuration(progress.positionSeconds)}
                </button>

                {sectionOpen ? (
                  <div className="section-composer">
                    <label>
                      <span>Preset</span>
                      <select
                        className="select-input"
                        value={sectionPresetId}
                        onChange={(event) => {
                          setSectionPresetId(event.target.value);
                          const preset = presets.find((item) => item.id === event.target.value);
                          if (preset && !sectionLabel) setSectionLabel(preset.label);
                        }}
                      >
                        <option value="">No preset</option>
                        {presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Label</span>
                      <input
                        className="text-input"
                        value={sectionLabel}
                        onChange={(event) => setSectionLabel(event.target.value)}
                        placeholder="e.g. Knee-cut entry"
                      />
                    </label>
                    <div className="time-inputs">
                      <label>
                        <span>Start (seconds)</span>
                        <input
                          className="text-input"
                          type="number"
                          min="0"
                          step="1"
                          value={sectionStart}
                          onChange={(event) => setSectionStart(Number(event.target.value))}
                        />
                      </label>
                      <label>
                        <span>End (optional)</span>
                        <input
                          className="text-input"
                          type="number"
                          min={sectionStart}
                          step="1"
                          value={sectionEnd}
                          onChange={(event) =>
                            setSectionEnd(event.target.value ? Number(event.target.value) : "")
                          }
                        />
                      </label>
                    </div>
                    <div className="composer-actions">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => setSectionOpen(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button button--primary"
                        type="button"
                        disabled={!sectionLabel.trim() && !sectionPresetId}
                        onClick={() => void createSection()}
                      >
                        Add division
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="section-list">
                  {sections.map((section) => {
                    const detail = sectionDetail(section);
                    return (
                      <article
                        className={`division-row ${section.focused ? "is-focused" : ""}`}
                        key={section.id}
                      >
                        <button
                          className="division-row__main"
                          type="button"
                          onClick={() => seek(section.startSeconds)}
                        >
                          <span className="time-chip">{formatDuration(section.startSeconds)}</span>
                          <span className="division-row__text">
                            <strong title={section.label}>{section.label}</strong>
                            {detail ? <small>{detail}</small> : null}
                          </span>
                        </button>
                        <div className="division-row__actions">
                          {section.practiceCount > 0 ? (
                            <span className="badge" title={`Practiced ${section.practiceCount} times`}>
                              ×{section.practiceCount}
                            </span>
                          ) : null}
                          <button
                            className={`icon-button icon-button--small ${section.starred ? "is-starred" : ""}`}
                            type="button"
                            aria-label={section.starred ? "Unstar division" : "Star division"}
                            aria-pressed={section.starred}
                            onClick={() => void updateSection(section, { starred: !section.starred })}
                          >
                            <Star size={14} fill={section.starred ? "currentColor" : "none"} />
                          </button>
                          <button
                            className={`icon-button icon-button--small ${section.focused ? "is-focused" : ""}`}
                            type="button"
                            aria-label={
                              section.focused ? "Remove from this week’s focus" : "Add to this week’s focus"
                            }
                            aria-pressed={section.focused}
                            title={section.focused ? "Remove from focus" : "Add to focus"}
                            onClick={() => void updateSection(section, { focused: !section.focused })}
                          >
                            <Target size={14} />
                          </button>
                          <button
                            className="icon-button icon-button--small"
                            type="button"
                            aria-label={`Mark ${section.label} practiced`}
                            title="Mark practiced"
                            onClick={() => void updateSection(section, { markPracticed: true })}
                          >
                            <Check size={14} />
                          </button>
                          <button
                            className="icon-button icon-button--small icon-button--danger"
                            type="button"
                            aria-label="Delete division"
                            onClick={async () => {
                              await api.deleteSection(videoId, section.id);
                              setSections((current) =>
                                current.filter((item) => item.id !== section.id),
                              );
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!sections.length ? (
                    <div className="mini-empty">
                      <ListVideo size={19} />
                      <strong>No divisions yet</strong>
                      <span>Create a chapter at the current playback position.</span>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </aside>
      </main>
      {presetManagerOpen ? (
        <PresetManager
          presets={presets}
          onClose={() => setPresetManagerOpen(false)}
          onChange={setPresets}
        />
      ) : null}
    </div>
  );
}
