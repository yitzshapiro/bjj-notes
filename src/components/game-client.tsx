"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleCheck, Swords, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, GameEntry, HitContext } from "@/lib/client-api";
import { formatDay, formatDuration } from "@/lib/format";
import {
  distinctDays,
  GAME_STATUS_HINT,
  GAME_STATUS_LABEL,
  gameStatus,
  GameStatus,
  HIT_CONTEXT_LABEL,
  HIT_CONTEXTS,
  nextStatusTarget,
} from "@/lib/game-status";
import { AppHeader } from "./app-header";
import { studyHref } from "./division-row";
import { ErrorState, LoadingState } from "./ui";

const STATUS_ORDER: GameStatus[] = ["core", "working", "landing", "untested"];

function EntryCard({
  entry,
  busy,
  onHit,
  onUndo,
  onRemove,
}: {
  entry: GameEntry;
  busy: boolean;
  onHit: (context: HitContext) => void;
  onUndo: () => void;
  onRemove: () => void;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const status = gameStatus(entry.hits);
  const days = distinctDays(entry.hits);
  const target = nextStatusTarget(status);
  const lastHit = entry.hits[0];

  return (
    <article className={`game-entry game-entry--${status}`}>
      <div className="game-entry__head">
        <Link
          className="game-entry__main"
          href={studyHref(entry.videoId, entry.video.name, entry.startSeconds)}
        >
          <span className="time-chip">{formatDuration(entry.startSeconds)}</span>
          <span className="game-entry__text">
            <strong title={entry.label}>{entry.label}</strong>
            <small title={entry.video.path.join(" / ")}>
              {entry.video.path.slice(2, -1).join(" · ")}
            </small>
          </span>
        </Link>
        <span className={`status-pill status-pill--${status}`} title={GAME_STATUS_HINT[status]}>
          {GAME_STATUS_LABEL[status]}
        </span>
      </div>

      <div className="game-entry__meter" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <i key={index} className={index < Math.min(days, 6) ? "is-on" : ""} />
        ))}
      </div>

      <p className="game-entry__stat">
        {entry.hits.length === 0 ? (
          "Not landed yet"
        ) : (
          <>
            <strong>{entry.hits.length}</strong> hit{entry.hits.length === 1 ? "" : "s"} across{" "}
            <strong>{days}</strong> day{days === 1 ? "" : "s"}
            {lastHit ? ` · last ${formatDay(lastHit.hitAt)}` : ""}
          </>
        )}
        {target ? (
          <span className="game-entry__target">
            {target.days - days > 0
              ? ` · ${target.days - days} more day${target.days - days === 1 ? "" : "s"} to ${GAME_STATUS_LABEL[target.next]}`
              : ""}
          </span>
        ) : null}
      </p>

      <div className="game-entry__actions">
        <button
          className="button button--primary"
          type="button"
          disabled={busy}
          onClick={() => onHit("live")}
        >
          <CircleCheck size={15} /> Hit it
        </button>
        <div className="context-control">
          <button
            className="button button--secondary"
            type="button"
            disabled={busy}
            aria-expanded={contextOpen}
            aria-haspopup="menu"
            onClick={() => setContextOpen((value) => !value)}
          >
            Other context
          </button>
          {contextOpen ? (
            <>
              <div
                className="speed-menu__scrim"
                role="presentation"
                onClick={() => setContextOpen(false)}
              />
              <ul className="speed-menu" role="menu">
                {HIT_CONTEXTS.map((context) => (
                  <li key={context}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onHit(context);
                        setContextOpen(false);
                      }}
                    >
                      {HIT_CONTEXT_LABEL[context]}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        {entry.hits.length ? (
          <button
            className="icon-button icon-button--bordered"
            type="button"
            disabled={busy}
            title="Undo the most recent hit"
            aria-label={`Undo the last hit on ${entry.label}`}
            onClick={onUndo}
          >
            <Undo2 size={15} />
          </button>
        ) : null}
        <button
          className="icon-button icon-button--bordered icon-button--danger"
          type="button"
          disabled={busy}
          title="Remove from My Game"
          aria-label={`Remove ${entry.label} from My Game`}
          onClick={onRemove}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

export function GameClient() {
  const router = useRouter();
  const [entries, setEntries] = useState<GameEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await api.game());
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Your game could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const hit = async (entry: GameEntry, context: HitContext) => {
    setBusyId(entry.id);
    try {
      const saved = await api.logHit(entry.id, { context });
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, hits: [saved, ...item.hits] } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That hit could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const undo = async (entry: GameEntry) => {
    setBusyId(entry.id);
    try {
      const { id } = await api.undoHit(entry.id);
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id ? { ...item, hits: item.hits.filter((h) => h.id !== id) } : item,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That hit could not be undone.");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (entry: GameEntry) => {
    if (!entry.sectionId) return;
    setBusyId(entry.id);
    try {
      await api.removeFromGame(entry.sectionId);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That could not be removed.");
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(() => {
    const buckets = new Map<GameStatus, GameEntry[]>();
    for (const entry of entries) {
      const status = gameStatus(entry.hits);
      buckets.set(status, [...(buckets.get(status) ?? []), entry]);
    }
    return STATUS_ORDER.map((status) => ({ status, entries: buckets.get(status) ?? [] })).filter(
      (group) => group.entries.length,
    );
  }, [entries]);

  const totalHits = entries.reduce((sum, entry) => sum + entry.hits.length, 0);
  const landed = entries.filter((entry) => gameStatus(entry.hits) !== "untested").length;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main">
        {loading ? <LoadingState label="Loading your game…" /> : null}
        {!loading && error && !entries.length ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error && !entries.length ? (
          <>
            <div className="page-head">
              <div>
                <h1>My Game</h1>
                <p>The techniques you are actually trying to land, and the record of when they worked.</p>
              </div>
            </div>
            <div className="empty-state">
              <span>
                <Swords size={20} />
              </span>
              <h2>Nothing in your game yet</h2>
              <p>
                Add a division from <Link href="/divisions">Divisions</Link> or from any game plan.
                Then mark it every time it works on the mat — status is earned from separate days,
                not from a single good round.
              </p>
              <Link className="button button--primary" href="/divisions">
                Browse divisions
              </Link>
            </div>
          </>
        ) : null}

        {!loading && entries.length ? (
          <>
            <div className="page-head">
              <div>
                <h1>My Game</h1>
                <p>The techniques you are actually trying to land, and the record of when they worked.</p>
              </div>
            </div>

            <div className="focus-stats">
              <div className="stat-card">
                <strong>{entries.length}</strong>
                <small>in your game</small>
              </div>
              <div className="stat-card">
                <strong>{landed}</strong>
                <small>landed at least once</small>
              </div>
              <div className="stat-card">
                <strong>{totalHits}</strong>
                <small>hits logged</small>
              </div>
            </div>

            {error ? (
              <div className="plan-inline-error" role="alert">
                {error}
              </div>
            ) : null}

            {grouped.map((group) => (
              <section className="focus-section" key={group.status}>
                <div className="focus-section__head">
                  <div>
                    <h2>{GAME_STATUS_LABEL[group.status]}</h2>
                    <p>{GAME_STATUS_HINT[group.status]}</p>
                  </div>
                  <span className="badge">{group.entries.length}</span>
                </div>
                <div className="game-list">
                  {group.entries.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      busy={busyId === entry.id}
                      onHit={(context) => void hit(entry, context)}
                      onUndo={() => void undo(entry)}
                      onRemove={() => void remove(entry)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : null}
      </main>
    </div>
  );
}
