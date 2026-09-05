"use client";

import Link from "next/link";
import { ArrowUpRight, Captions, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type CaptionSearchPayload } from "@/lib/client-api";
import { formatDuration } from "@/lib/format";
import { highlightedTranscriptParts, transcriptSearchHref } from "@/lib/transcript-search-ui";
import styles from "./transcript-search.module.css";

const PAGE_SIZE = 20;

type SearchState = {
  key: string;
  payload: CaptionSearchPayload | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
};

/** Spoken matches share the Library search field and link straight to each cue. */
export function TranscriptSearch({ query }: { query: string }) {
  const trimmed = query.trim().replace(/\s+/gu, " ");
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState | null>(null);
  const request = useRef<{ key: string; controller: AbortController; loadingMore: boolean } | null>(null);
  const key = `${trimmed}\u0000${attempt}`;
  const valid = trimmed.length >= 2 && trimmed.length <= 120;
  const current = state?.key === key ? state : null;

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    const active = { key, controller, loadingMore: false };
    request.current = active;
    const timer = setTimeout(() => {
      setState({ key, payload: null, loading: true, loadingMore: false, error: null });
      api.searchCaptions({ q: trimmed, limit: PAGE_SIZE, offset: 0 }, controller.signal)
        .then((payload) => {
          if (controller.signal.aborted || request.current !== active) return;
          setState({ key, payload, loading: false, loadingMore: false, error: null });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || request.current !== active) return;
          setState({ key, payload: null, loading: false, loadingMore: false,
            error: error instanceof Error ? error.message : "Transcript search could not be loaded." });
        });
    }, 275);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, trimmed, valid]);

  const loadMore = async () => {
    const active = request.current;
    const nextOffset = current?.payload?.nextOffset;
    if (!active || active.key !== key || active.controller.signal.aborted || active.loadingMore || nextOffset == null) return;
    active.loadingMore = true;
    setState((previous) => previous?.key === key ? { ...previous, loadingMore: true, error: null } : previous);
    try {
      const payload = await api.searchCaptions({ q: trimmed, limit: PAGE_SIZE, offset: nextOffset }, active.controller.signal);
      if (active.controller.signal.aborted || request.current !== active) return;
      setState((previous) => {
        if (previous?.key !== key || !previous.payload) return previous;
        const seen = new Set(previous.payload.results.map((hit) => `${hit.videoId}:${hit.startSeconds}:${hit.endSeconds}`));
        return { key, loading: false, loadingMore: false, error: null, payload: {
          ...payload, results: [...previous.payload.results, ...payload.results.filter((hit) => !seen.has(`${hit.videoId}:${hit.startSeconds}:${hit.endSeconds}`))],
        } };
      });
    } catch (error) {
      if (active.controller.signal.aborted || request.current !== active) return;
      setState((previous) => previous?.key === key ? { ...previous, loadingMore: false,
        error: error instanceof Error ? error.message : "More transcript matches could not be loaded." } : previous);
    } finally { active.loadingMore = false; }
  };

  if (!trimmed) return null;
  const loading = valid && (!current || current.loading);
  const payload = current?.payload;
  const results = payload?.results ?? [];
  return (
    <section className={styles.section} aria-label="Spoken transcript matches" aria-busy={loading || current?.loadingMore}>
      <div className={styles.heading}>
        <h2><Captions size={17} aria-hidden="true" /> Spoken matches</h2>
        {payload ? <span>{payload.total.toLocaleString()} {payload.total === 1 ? "match" : "matches"}</span> : null}
      </div>
      <div className={styles.status} role="status" aria-live="polite">
        {!valid ? <p>{trimmed.length < 2 ? "Type at least 2 characters to search transcripts." : "Use 120 characters or fewer to search transcripts."}</p> : null}
        {loading ? <p><LoaderCircle className="spin" size={15} aria-hidden="true" /> Searching transcripts…</p> : null}
        {payload && !results.length ? <p>No spoken matches for “{trimmed}”. Try a shorter phrase or a technique name.</p> : null}
        {payload && results.length ? <span className="sr-only">{payload.total} spoken matches. Showing {results.length}.</span> : null}
      </div>
      {results.length ? (
        <ol className={styles.results}>
          {results.map((hit) => {
            const folder = hit.path.slice(0, hit.path.at(-1) === hit.videoName ? -1 : undefined).join(" / ");
            return (
              <li key={`${hit.videoId}:${hit.startSeconds}:${hit.endSeconds}`}>
                <Link className={styles.result} href={transcriptSearchHref(hit.videoId, hit.videoName, hit.startSeconds)}>
                  <span className={styles.time} aria-label={`Play at ${formatDuration(hit.startSeconds)}`}>{formatDuration(hit.startSeconds)}</span>
                  <div className={styles.copy}>
                    <strong className={styles.title}>{hit.videoName}</strong>
                    {folder ? <span className={styles.folder}>{folder}</span> : null}
                    <p className={styles.snippet}>{highlightedTranscriptParts(hit.snippet, payload?.normalizedQuery || payload?.query || trimmed).map((part, index) =>
                      part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
                    )}</p>
                  </div>
                  <ArrowUpRight className={styles.arrow} size={16} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
      ) : null}
      {current?.error ? (
        <div className={styles.error} role="alert">
          <p>{current.error}</p>
          <button type="button" className="button button--secondary" onClick={() => results.length ? void loadMore() : setAttempt((value) => value + 1)}>
            <RefreshCw size={14} aria-hidden="true" /> Retry search
          </button>
        </div>
      ) : null}
      {payload?.nextOffset != null && !current?.error ? (
        <div className={styles.more}>
          <span>Showing {results.length.toLocaleString()} of {payload.total.toLocaleString()}</span>
          <button type="button" className="button button--secondary" disabled={current?.loadingMore} onClick={() => void loadMore()}>
            {current?.loadingMore ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            {current?.loadingMore ? "Loading…" : "Show more matches"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
