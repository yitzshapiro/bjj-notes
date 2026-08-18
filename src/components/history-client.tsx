"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, FileText, History, ListVideo, Play } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, HistoryEntry, HistoryPayload, HistoryScope } from "@/lib/client-api";
import { formatDuration, formatPercent } from "@/lib/format";
import { formatWatchedAt, groupHistory } from "@/lib/history";
import { AppHeader } from "./app-header";
import { ErrorState, LoadingState, Thumbnail } from "./ui";

const SCOPES: { value: HistoryScope; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in-progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "starred", label: "Starred" },
];

/** Resume where playback stopped, unless the video is finished. */
function resumeHref(entry: HistoryEntry) {
  const params = new URLSearchParams({ name: entry.name });
  if (!entry.completed && entry.positionSeconds > 30) {
    params.set("t", String(Math.floor(entry.positionSeconds)));
  }
  return `/library/${encodeURIComponent(entry.videoId)}?${params}`;
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const remaining =
    entry.durationSeconds && !entry.completed
      ? Math.max(0, entry.durationSeconds - entry.positionSeconds)
      : 0;

  return (
    <Link className="history-row" href={resumeHref(entry)}>
      <Thumbnail
        videoId={entry.videoId}
        progress={entry.progress}
        durationSeconds={entry.durationSeconds ?? undefined}
        starred={entry.starred}
        completed={entry.completed}
      />
      <span className="history-row__body">
        <strong className="truncate" title={entry.name}>
          {entry.name}
        </strong>
        <small className="truncate" title={entry.path.join(" / ")}>
          {entry.path.slice(2, -1).join(" · ")}
        </small>

        <span className="history-row__meta">
          <span title={formatWatchedAt(entry.lastWatchedAt)}>
            <Clock3 size={12} />
            {new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
              new Date(entry.lastWatchedAt),
            )}
          </span>
          {entry.divisionCount > 0 ? (
            <span>
              <ListVideo size={12} />
              {entry.divisionCount} divisions
            </span>
          ) : null}
          {entry.noteCount > 0 ? (
            <span>
              <FileText size={12} />
              {entry.noteCount} note{entry.noteCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>

        <span className="history-row__progress">
          <span className="progress">
            <span className="progress__fill" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
          </span>
          <small>
            {entry.completed
              ? "Completed"
              : entry.durationSeconds
                ? `${formatPercent(entry.progress)} · ${formatDuration(remaining)} left`
                : formatDuration(entry.positionSeconds)}
          </small>
        </span>
      </span>
      <span className="history-row__action" aria-hidden="true">
        <Play size={15} />
      </span>
    </Link>
  );
}

export function HistoryClient() {
  const router = useRouter();
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [scope, setScope] = useState<HistoryScope>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await api.history(scope));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Your history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router, scope]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const groups = useMemo(
    () => groupHistory(payload?.entries ?? [], (entry) => entry.lastWatchedAt),
    [payload],
  );

  const hours = payload ? Math.round((payload.totals.seconds / 3600) * 10) / 10 : 0;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main">
        <div className="page-head">
          <div>
            <h1>History</h1>
            <p>
              Everything you have watched in the last year, most recent first. Nothing is deleted —
              this view simply stops at twelve months.
            </p>
          </div>
        </div>

        {payload && payload.totals.watched > 0 ? (
          <div className="focus-stats">
            <div className="stat-card">
              <strong>{payload.totals.watched}</strong>
              <small>videos opened</small>
            </div>
            <div className="stat-card">
              <strong>{payload.totals.completed}</strong>
              <small>finished</small>
            </div>
            <div className="stat-card">
              <strong>{hours}h</strong>
              <small>watched</small>
            </div>
          </div>
        ) : null}

        <div className="filter-pills history-filters">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={scope === item.value ? "is-active" : ""}
              aria-pressed={scope === item.value}
              onClick={() => setScope(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? <LoadingState label="Loading your history…" /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}

        {!loading && !error && groups.length
          ? groups.map((group) => (
              <section className="history-group" key={group.key}>
                <div className="history-group__head">
                  <h2>{group.label}</h2>
                  <span className="badge">{group.entries.length}</span>
                </div>
                <div className="history-list">
                  {group.entries.map((entry) => (
                    <HistoryRow key={entry.videoId} entry={entry} />
                  ))}
                </div>
              </section>
            ))
          : null}

        {!loading && !error && !groups.length ? (
          <div className="empty-state">
            <span>
              <History size={20} />
            </span>
            <h2>{scope === "all" ? "Nothing watched yet" : "Nothing here"}</h2>
            <p>
              {scope === "all"
                ? "Open a video and your watch history will build up here, grouped by when you watched it."
                : "No videos in the last year match that filter. Try another one."}
            </p>
            <Link className="button button--primary" href="/library">
              Go to the library
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
