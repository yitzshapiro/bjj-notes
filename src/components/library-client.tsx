"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Cloud,
  FileVideo,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, LibraryNode, videoStatus, VideoStatus } from "@/lib/client-api";
import { formatDate, formatDuration, formatPercent } from "@/lib/format";
import { AppHeader } from "./app-header";
import { ErrorState, LoadingState, ProgressBar } from "./ui";

type Filter = "all" | VideoStatus | "starred";

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in-progress", label: "In progress" },
  { id: "unwatched", label: "Unwatched" },
  { id: "completed", label: "Completed" },
  { id: "starred", label: "Starred" },
];

function flatten(node: LibraryNode): LibraryNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

function folderPath(root: LibraryNode, id: string): LibraryNode[] {
  if (root.id === id) return [root];
  for (const child of root.children) {
    if (child.kind !== "folder") continue;
    const match = folderPath(child, id);
    if (match.length) return [root, ...match];
  }
  return [];
}

function matchesFilter(node: LibraryNode, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "starred") return node.starred;
  return videoStatus(node) === filter;
}

function TreeBranch({
  node,
  activeId,
  onSelect,
  depth = 0,
}: {
  node: LibraryNode;
  activeId: string;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState(depth < 1 || node.id === activeId);
  const folders = node.children.filter((child) => child.kind === "folder");

  return (
    <li>
      <div className={`tree-row ${activeId === node.id ? "is-active" : ""}`}>
        {folders.length ? (
          <button
            className="tree-row__toggle"
            type="button"
            aria-label={`${open ? "Collapse" : "Expand"} ${node.name}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        ) : (
          <span className="tree-row__spacer" />
        )}
        <button className="tree-row__label" type="button" onClick={() => onSelect(node.id)}>
          {open ? <FolderOpen size={17} /> : <Folder size={17} />}
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {open && folders.length ? (
        <ul className="tree-list tree-list--nested">
          {folders.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function VideoCard({ node }: { node: LibraryNode }) {
  const progress = node.progress ?? 0;
  const status = videoStatus(node);
  return (
    <article className="video-card">
      <div className="video-card__visual" aria-hidden="true">
        <span className="video-card__glyph">
          <FileVideo size={24} />
        </span>
        <span className={`status-pill status-pill--${status}`}>
          {status === "in-progress" ? "In progress" : status === "completed" ? "Completed" : "Unwatched"}
        </span>
        {node.starred ? <Star className="video-card__star" size={18} fill="currentColor" /> : null}
      </div>
      <div className="video-card__body">
        <div>
          <h3>{node.name}</h3>
          <p className="meta-line">
            {node.durationSeconds ? formatDuration(node.durationSeconds) : "Video"}
            <span aria-hidden="true">·</span>
            {formatDate(node.updatedAt)}
          </p>
        </div>
        <div className="video-card__progress">
          <ProgressBar value={progress} label={`${node.name}: ${formatPercent(progress)} complete`} />
          <span>{formatPercent(progress)}</span>
        </div>
        <Link className="button button--secondary button--full" href={`/library/${encodeURIComponent(node.id)}?name=${encodeURIComponent(node.name)}`}>
          {status === "unwatched" ? "Start studying" : status === "completed" ? "Review" : "Continue"}
          <ChevronRight size={16} />
        </Link>
      </div>
    </article>
  );
}

export function LibraryClient() {
  const router = useRouter();
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof api.library>> | null>(null);
  const [activeFolderId, setActiveFolderId] = useState("root");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextLibrary = await api.library();
      setLibrary(nextLibrary);
      setActiveFolderId((current) =>
        flatten(nextLibrary.root).some((node) => node.id === current) ? current : nextLibrary.root.id,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your library could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data comes from the authenticated client API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api.sync();
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) router.replace("/");
      else setError(caught instanceof Error ? caught.message : "Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const allNodes = useMemo(() => (library ? flatten(library.root) : []), [library]);
  const activeFolder = allNodes.find((node) => node.id === activeFolderId) ?? library?.root;
  const activePath = library && activeFolder ? folderPath(library.root, activeFolder.id) : [];
  const searching = query.trim().length > 0;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const videos = (searching ? allNodes : activeFolder?.children ?? [])
    .filter((node) => node.kind === "video")
    .filter((node) => node.name.toLocaleLowerCase().includes(normalizedQuery))
    .filter((node) => matchesFilter(node, filter));
  const childFolders = searching
    ? []
    : (activeFolder?.children ?? []).filter((node) => node.kind === "folder");
  const inProgress = allNodes
    .filter((node) => node.kind === "video" && videoStatus(node) === "in-progress")
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const resume = inProgress[0];
  const totalVideos = allNodes.filter((node) => node.kind === "video").length;
  const completedVideos = allNodes.filter(
    (node) => node.kind === "video" && videoStatus(node) === "completed",
  ).length;

  return (
    <div className="app-page">
      <AppHeader
        trailing={
          <button className="button button--secondary" type="button" onClick={sync} disabled={syncing}>
            <RefreshCw className={syncing ? "spin" : ""} size={16} />
            <span className="desktop-only">{syncing ? "Syncing…" : "Sync Drive"}</span>
          </button>
        }
      />
      <div className="library-layout">
        {library ? (
          <aside className="library-sidebar" aria-label="Drive folders">
            <div className="eyebrow">Google Drive</div>
            <ul className="tree-list">
              <TreeBranch node={library.root} activeId={activeFolderId} onSelect={setActiveFolderId} />
            </ul>
            <div className="sidebar-sync">
              <Cloud size={17} />
              <span>
                <strong>Drive connected</strong>
                <small>{library.syncedAt ? `Synced ${formatDate(library.syncedAt)}` : "Ready to sync"}</small>
              </span>
            </div>
          </aside>
        ) : null}
        <main className="library-main">
          {loading ? <LoadingState /> : null}
          {!loading && error ? <ErrorState message={error} onRetry={load} /> : null}
          {!loading && library ? (
            <>
              <section className="library-hero">
                <div>
                  <p className="eyebrow">Study library</p>
                  <h1>Library</h1>
                  <p>Videos from your selected Google Drive folder.</p>
                </div>
                {totalVideos ? (
                  <div className="completion-card" aria-label={`${completedVideos} of ${totalVideos} videos completed`}>
                    <span className="completion-card__icon"><Check size={19} /></span>
                    <span><strong>{completedVideos} of {totalVideos}</strong><small>videos completed</small></span>
                  </div>
                ) : null}
              </section>

              {resume ? (
                <section className="resume-card">
                  <div className="resume-card__icon"><CirclePlay size={25} /></div>
                  <div className="resume-card__copy">
                    <div className="eyebrow">Resume</div>
                    <h2>{resume.name}</h2>
                    <div className="resume-card__progress">
                      <ProgressBar value={resume.progress ?? 0} />
                      <span>{formatPercent(resume.progress)}</span>
                    </div>
                  </div>
                  <Link className="button button--primary" href={`/library/${encodeURIComponent(resume.id)}?name=${encodeURIComponent(resume.name)}`}>
                    Continue <ChevronRight size={16} />
                  </Link>
                </section>
              ) : null}

              <section className="library-browser">
                <div className="browser-toolbar">
                  <label className="search-field">
                    <Search size={18} />
                    <span className="sr-only">Search videos</span>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library" />
                    {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={16} /></button> : null}
                  </label>
                  <button className="button button--secondary mobile-only" type="button" onClick={() => setFiltersOpen((value) => !value)}>
                    <SlidersHorizontal size={16} /> Filters
                  </button>
                  <div className={`filter-pills ${filtersOpen ? "is-open" : ""}`} aria-label="Filter videos">
                    {filters.map((item) => (
                      <button key={item.id} className={filter === item.id ? "is-active" : ""} type="button" onClick={() => { setFilter(item.id); setFiltersOpen(false); }}>
                        {item.id === "starred" ? <Star size={14} /> : null}{item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {!searching ? (
                  <nav className="breadcrumbs" aria-label="Folder path">
                    {activePath.map((node, index) => (
                      <span key={node.id}>
                        {index ? <ChevronRight size={14} /> : null}
                        <button type="button" onClick={() => setActiveFolderId(node.id)} aria-current={index === activePath.length - 1 ? "page" : undefined}>{node.name}</button>
                      </span>
                    ))}
                  </nav>
                ) : <p className="search-summary">Results across your full Drive hierarchy</p>}

                {childFolders.length ? (
                  <div className="folder-grid">
                    {childFolders.map((folder) => (
                      <button key={folder.id} className="folder-card" type="button" onClick={() => setActiveFolderId(folder.id)}>
                        <span><Folder size={19} /><strong>{folder.name}</strong></span>
                        <small>{folder.children.length} item{folder.children.length === 1 ? "" : "s"}</small>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                ) : null}

                {videos.length ? <div className="video-grid">{videos.map((video) => <VideoCard key={video.id} node={video} />)}</div> : null}

                {!childFolders.length && !videos.length ? (
                  <div className="empty-state">
                    <span><Sparkles size={23} /></span>
                    <h2>{totalVideos ? "No matches" : "No videos synced"}</h2>
                    <p>{totalVideos ? "Change the filter, search, or folder." : "Sync the selected Google Drive folder."}</p>
                    {!totalVideos ? <button className="button button--primary" type="button" onClick={sync}><RefreshCw size={16} /> Sync Drive</button> : null}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
