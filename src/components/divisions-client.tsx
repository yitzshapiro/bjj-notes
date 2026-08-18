"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Search, SlidersHorizontal, Star, Tags, Target, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  BrowsedDivision,
  DivisionScopeFilter,
  LibraryTag,
  TagKind,
} from "@/lib/client-api";
import { formatDay, formatDuration } from "@/lib/format";
import { AppHeader } from "./app-header";
import { studyHref } from "./division-row";
import { ErrorState, LoadingState } from "./ui";

const KIND_ORDER: TagKind[] = ["position", "phase", "technique"];
const KIND_LABEL: Record<TagKind, string> = {
  position: "Position",
  phase: "Phase",
  technique: "Technique",
};

const SCOPES: { value: DivisionScopeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "focus", label: "In focus" },
  { value: "starred", label: "Starred" },
  { value: "practiced", label: "Practiced" },
  { value: "untouched", label: "Not yet drilled" },
];

const PAGE_SIZE = 60;

function DivisionCard({
  division,
  busy,
  onChange,
}: {
  division: BrowsedDivision;
  busy: boolean;
  onChange: (changes: { focused?: boolean; starred?: boolean; markPracticed?: boolean }) => void;
}) {
  return (
    <article className={`browse-row ${division.focused ? "is-focused" : ""}`}>
      <Link
        className="browse-row__main"
        href={studyHref(division.videoId, division.video.name, division.startSeconds)}
      >
        <span className="time-chip">{formatDuration(division.startSeconds)}</span>
        <span className="browse-row__text">
          <strong title={division.label}>{division.label}</strong>
          <small title={division.video.path.join(" / ")}>
            {division.video.path.slice(2, -1).join(" · ")}
            {division.lastPracticedAt ? ` · Practiced ${formatDay(division.lastPracticedAt)}` : ""}
          </small>
          {division.tags.length ? (
            <span className="browse-row__tags">
              {division.tags.map((tag) => (
                <span
                  key={tag.slug}
                  className={`tag-chip tag-chip--${tag.kind} ${tag.confidence < 0.7 ? "is-unsure" : ""}`}
                  title={
                    tag.confidence < 0.7
                      ? `${tag.label} — inferred from the instructional, worth confirming`
                      : tag.label
                  }
                >
                  {tag.label}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </Link>
      <div className="browse-row__actions">
        {division.practiceCount > 0 ? (
          <span className="badge" title={`Practiced ${division.practiceCount} times`}>
            ×{division.practiceCount}
          </span>
        ) : null}
        <button
          className={`icon-button icon-button--small ${division.starred ? "is-starred" : ""}`}
          type="button"
          disabled={busy}
          aria-label={division.starred ? `Unstar ${division.label}` : `Star ${division.label}`}
          aria-pressed={division.starred}
          onClick={() => onChange({ starred: !division.starred })}
        >
          <Star size={14} fill={division.starred ? "currentColor" : "none"} />
        </button>
        <button
          className={`icon-button icon-button--small ${division.focused ? "is-focused" : ""}`}
          type="button"
          disabled={busy}
          aria-label={division.focused ? `Remove ${division.label} from focus` : `Add ${division.label} to focus`}
          aria-pressed={division.focused}
          title={division.focused ? "Remove from focus" : "Add to focus"}
          onClick={() => onChange({ focused: !division.focused })}
        >
          <Target size={14} />
        </button>
        <button
          className="icon-button icon-button--small"
          type="button"
          disabled={busy}
          aria-label={`Mark ${division.label} practiced`}
          title="Mark practiced"
          onClick={() => onChange({ markPracticed: true })}
        >
          <Check size={14} />
        </button>
      </div>
    </article>
  );
}

export function DivisionsClient() {
  const router = useRouter();
  const [vocabulary, setVocabulary] = useState<LibraryTag[]>([]);
  const [divisions, setDivisions] = useState<BrowsedDivision[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<DivisionScopeFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api
      .tags()
      .then(setVocabulary)
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      });
  }, [router]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await api.searchDivisions({
        q: debouncedQuery || undefined,
        tags: selected,
        scope,
        limit: PAGE_SIZE,
        offset,
      });
      setDivisions(payload.divisions);
      setTotal(payload.total);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "That search could not be run.");
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, offset, router, scope, selected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const toggleTag = (slug: string) => {
    setOffset(0);
    setSelected((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  };

  const change = async (
    division: BrowsedDivision,
    changes: { focused?: boolean; starred?: boolean; markPracticed?: boolean },
  ) => {
    setBusyId(division.id);
    try {
      const saved = await api.saveSection(division.videoId, { id: division.id, ...changes });
      setDivisions((current) =>
        current.map((item) => (item.id === division.id ? { ...item, ...saved } : item)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That change could not be saved.");
    } finally {
      setBusyId(null);
    }
  };

  const grouped = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({
        kind,
        tags: vocabulary.filter((tag) => tag.kind === kind && tag.count > 0),
      })).filter((group) => group.tags.length),
    [vocabulary],
  );

  const filtered = selected.length > 0 || Boolean(debouncedQuery) || scope !== "all";
  const showing = divisions.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const page = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="app-page">
      <AppHeader />
      <main className="focus-main focus-main--wide">
        <div className="page-head">
          <div>
            <h1>Divisions</h1>
            <p>
              Every technique in the library, tagged by position and phase. Search it instead of
              remembering which volume something was in.
            </p>
          </div>
        </div>

        <div className="browse-toolbar">
          <label className="search-field">
            <Search size={15} />
            <span className="sr-only">Search divisions</span>
            <input
              className="search-field__input"
              type="search"
              placeholder="Search 3,000+ divisions — try “triangle” or “knee cut”…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                className="icon-button icon-button--small"
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
              >
                <X size={14} />
              </button>
            ) : null}
          </label>
          <button
            className={`button button--secondary ${filtersOpen ? "is-active" : ""}`}
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            <SlidersHorizontal size={15} />
            Filters
            {selected.length ? <span className="badge badge--solid">{selected.length}</span> : null}
          </button>
        </div>

        <div className="filter-pills">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={scope === item.value ? "is-active" : ""}
              aria-pressed={scope === item.value}
              onClick={() => {
                setScope(item.value);
                setOffset(0);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {filtersOpen ? (
          <div className="tag-picker">
            {grouped.map((group) => (
              <section key={group.kind}>
                <p className="eyebrow">{KIND_LABEL[group.kind]}</p>
                <div className="tag-picker__row">
                  {group.tags.map((tag) => (
                    <button
                      key={tag.slug}
                      type="button"
                      className={`tag-chip tag-chip--${tag.kind} tag-chip--button ${selected.includes(tag.slug) ? "is-selected" : ""}`}
                      aria-pressed={selected.includes(tag.slug)}
                      onClick={() => toggleTag(tag.slug)}
                    >
                      {tag.label}
                      <span className="tag-chip__count">{tag.count}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {selected.length ? (
          <div className="active-filters">
            <span className="eyebrow">Showing divisions tagged</span>
            {selected.map((slug) => {
              const tag = vocabulary.find((item) => item.slug === slug);
              return (
                <button
                  key={slug}
                  className="tag-chip tag-chip--button is-selected"
                  type="button"
                  onClick={() => toggleTag(slug)}
                  aria-label={`Remove ${tag?.label ?? slug} filter`}
                >
                  {tag?.label ?? slug}
                  <X size={11} />
                </button>
              );
            })}
            <button className="text-button" type="button" onClick={() => setSelected([])}>
              Clear all
            </button>
          </div>
        ) : null}

        <p className="browse-count">
          {loading
            ? "Searching…"
            : total === 0
              ? "No divisions match"
              : `${total.toLocaleString()} division${total === 1 ? "" : "s"}${filtered ? " match" : ""}${
                  pages > 1 ? ` · showing ${showing}, page ${page} of ${pages}` : ""
                }`}
        </p>

        {error ? <div className="plan-inline-error" role="alert">{error}</div> : null}
        {loading && !divisions.length ? <LoadingState label="Searching divisions…" /> : null}
        {!loading && error && !divisions.length ? <ErrorState message={error} onRetry={load} /> : null}

        {divisions.length ? (
          <div className="browse-list">
            {divisions.map((division) => (
              <DivisionCard
                key={division.id}
                division={division}
                busy={busyId === division.id}
                onChange={(changes) => void change(division, changes)}
              />
            ))}
          </div>
        ) : null}

        {!loading && !divisions.length && !error ? (
          <div className="mini-empty">
            <Tags size={20} />
            <strong>Nothing matches those filters</strong>
            <span>Remove a tag or clear the search to widen the results.</span>
          </div>
        ) : null}

        {pages > 1 ? (
          <div className="browse-pager">
            <button
              className="button button--secondary"
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
              Previous
            </button>
            <span>
              Page {page} of {pages}
            </span>
            <button
              className="button button--secondary"
              type="button"
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >
              Next
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
