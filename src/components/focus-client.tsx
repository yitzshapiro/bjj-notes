"use client";

import { useRouter } from "next/navigation";
import { Check, History, Repeat, Target, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, DivisionTotals, LibraryDivision } from "@/lib/client-api";
import { formatDay, formatFocusAge } from "@/lib/format";
import { AppHeader } from "./app-header";
import { DivisionRow } from "./division-row";
import { ErrorState, LoadingState } from "./ui";

const emptyTotals: DivisionTotals = { focused: 0, practiced: 0, starred: 0, reps: 0 };

export function FocusClient() {
  const router = useRouter();
  const [divisions, setDivisions] = useState<LibraryDivision[]>([]);
  const [totals, setTotals] = useState<DivisionTotals>(emptyTotals);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.divisions("all");
      setDivisions(payload.sections);
      setTotals(payload.totals ?? emptyTotals);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Your focus list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const update = async (division: LibraryDivision, changes: { focused?: boolean; markPracticed?: boolean }) => {
    setBusyId(division.id);
    try {
      const saved = await api.saveSection(division.videoId, { id: division.id, ...changes });
      setDivisions((current) =>
        current.map((item) => (item.id === division.id ? { ...item, ...saved } : item)),
      );
      setTotals((current) => ({
        ...current,
        focused: current.focused + (saved.focused ? 1 : 0) - (division.focused ? 1 : 0),
        practiced: current.practiced + (division.practiceCount === 0 && saved.practiceCount > 0 ? 1 : 0),
        reps: current.reps + (saved.practiceCount - division.practiceCount),
      }));
    } finally {
      setBusyId(null);
    }
  };

  const focused = divisions
    .filter((division) => division.focused)
    .sort((a, b) => (a.focusAddedAt ?? "").localeCompare(b.focusAddedAt ?? ""));
  const practiced = divisions
    .filter((division) => !division.focused && division.practiceCount > 0)
    .sort((a, b) => (b.lastPracticedAt ?? "").localeCompare(a.lastPracticedAt ?? ""));

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main">
        {loading ? <LoadingState label="Loading your focus list…" /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}
        {!loading && !error ? (
          <>
            <div className="page-head">
              <div>
                <h1>Focus</h1>
                <p>Divisions you’re drilling now, and everything you’ve already put reps into.</p>
              </div>
            </div>

            <div className="focus-stats">
              <div className="stat-card">
                <strong>{focused.length}</strong>
                <small>in focus</small>
              </div>
              <div className="stat-card">
                <strong>{totals.practiced}</strong>
                <small>divisions practiced</small>
              </div>
              <div className="stat-card">
                <strong>{totals.reps}</strong>
                <small>total reps logged</small>
              </div>
            </div>

            <section className="focus-section">
              <div className="focus-section__head">
                <div>
                  <h2>This week</h2>
                  <p>These carry over week to week until you mark them practiced.</p>
                </div>
                <span className="badge">{focused.length}</span>
              </div>
              {focused.length ? (
                <div className="division-list">
                  {focused.map((division) => (
                    <DivisionRow
                      key={division.id}
                      division={division}
                      detail={formatFocusAge(division.focusAddedAt)}
                      actions={
                        <>
                          <button
                            className="icon-button icon-button--small"
                            type="button"
                            disabled={busyId === division.id}
                            aria-label={`Mark ${division.label} practiced`}
                            title="Mark practiced"
                            onClick={() => void update(division, { markPracticed: true })}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            className="icon-button icon-button--small"
                            type="button"
                            disabled={busyId === division.id}
                            aria-label={`Remove ${division.label} from focus`}
                            title="Remove from focus"
                            onClick={() => void update(division, { focused: false })}
                          >
                            <X size={15} />
                          </button>
                        </>
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="mini-empty">
                  <Target size={20} />
                  <strong>Nothing in focus</strong>
                  <span>Star or focus a division from a video to build this week’s list.</span>
                </div>
              )}
            </section>

            <section className="focus-section">
              <div className="focus-section__head">
                <div>
                  <h2>Practiced</h2>
                  <p>A running tally of what you’ve already drilled, most recent first.</p>
                </div>
                <span className="badge">{practiced.length}</span>
              </div>
              {practiced.length ? (
                <div className="division-list">
                  {practiced.map((division) => (
                    <DivisionRow
                      key={division.id}
                      division={division}
                      detail={formatDay(division.lastPracticedAt)}
                      actions={
                        <button
                          className="icon-button icon-button--small"
                          type="button"
                          disabled={busyId === division.id}
                          aria-label={`Put ${division.label} back in focus`}
                          title="Focus again"
                          onClick={() => void update(division, { focused: true })}
                        >
                          <Repeat size={15} />
                        </button>
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="mini-empty">
                  <History size={20} />
                  <strong>No reps logged yet</strong>
                  <span>Marking a focus division practiced moves it here with a running count.</span>
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
